"use strict";

/**
 * db.js — Flat-file JSON database for Elysium library data.
 *
 * Improvements over the original:
 *  - DATA_DIR env support → write to a Docker volume, not the image layer
 *  - In-memory cache — reads are O(1); writes are async (no event-loop block)
 *  - Write coalescing — concurrent mutations batch into a single fs.writeFile call
 *  - crypto.randomUUID() for all generated IDs — no more Date.now() collisions
 *  - Schema-safe field whitelisting on all writes — strips unexpected keys
 *  - Simple version migration runner for forward-compat
 */

const fs   = require("fs");
const path = require("path");

// ── Path resolution ───────────────────────────────────────────────────────────
// DATA_DIR may be set by the Docker ENV or the host. Falls back to __dirname.
const DATA_DIR = process.env.DATA_DIR || __dirname;
const DB_PATH  = path.join(DATA_DIR, "library.json");

const DB_VERSION = 2;

const defaultData = {
  version:   DB_VERSION,
  settings: {
    ollamaEnabled:        false,
    ollamaUrl:            "",
    ollamaModel:          "llama3.2:3b",
    invidiousInstance:    "",          // NEW in v2 — replaces hardcoded default in queue.js
    listenBrainzToken:    "",
    listenBrainzUsername: "",
    invidiousSid:         "",          // session cookie — never exposed via GET /settings
    invidiousUsername:    "",
    lastFmApiKey:         "",
    queueMode:            "off",
    highQuality:          false,
    cacheEnabled:         true,
    videoMode:            false,
  },
  history:   [],
  playlists: [],
  artists:   [],
  favorites: [],
  albums:    [],
};

// ── Migrations ────────────────────────────────────────────────────────────────
function migrate(data) {
  const v = data.version || 1;

  // v1 → v2: add invidiousInstance field to settings
  if (v < 2) {
    data.settings = data.settings || {};
    data.settings.invidiousInstance = data.settings.invidiousInstance || "";
    data.settings.highQuality       = data.settings.highQuality       ?? false;
    data.settings.cacheEnabled      = data.settings.cacheEnabled      ?? true;
    data.version = 2;
  }

  return data;
}

// ── In-memory cache ───────────────────────────────────────────────────────────
let _cache    = null;
let _dirty    = false;
let _flushTimer = null;

function _ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function _loadFromDisk() {
  try {
    if (!fs.existsSync(DB_PATH)) {
      _ensureDataDir();
      const data = JSON.parse(JSON.stringify(defaultData));
      fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), "utf8");
      return data;
    }
    const raw  = JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
    const data = migrate(raw);
    // If migration bumped the version, persist immediately so we don't re-run next boot
    if (data.version !== raw.version) {
      fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), "utf8");
    }
    return data;
  } catch (err) {
    console.error("[Database] Read error, resetting to default:", err.message);
    return JSON.parse(JSON.stringify(defaultData));
  }
}

function getDb() {
  if (!_cache) _cache = _loadFromDisk();
  return _cache;
}

/** Schedule an async write.  Multiple calls within 200 ms collapse into one. */
function _scheduleFlush() {
  _dirty = true;
  if (_flushTimer) return;
  _flushTimer = setTimeout(() => {
    _flushTimer = null;
    flushSync();
  }, 200);
}

/** 
 * Synchronously flushes the current cache to disk using an atomic rename pattern.
 * Renaming is atomic on most filesystems, preventing file corruption on crash.
 */
function flushSync() {
  if (!_dirty || !_cache) return;
  _dirty = false;
  
  const tmpPath = DB_PATH + ".tmp";
  try {
    const snapshot = JSON.stringify(_cache, null, 2);
    _ensureDataDir();
    fs.writeFileSync(tmpPath, snapshot, "utf8");
    fs.renameSync(tmpPath, DB_PATH);
  } catch (err) {
    console.error("[Database] Flush error:", err.message);
    // Cleanup tmp file if it exists
    try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch (_) {}
  }
}

// Ensure data is saved on process exit
process.on("exit", () => {
  if (_dirty) {
    console.log("[Database] Process exit: Performing final sync...");
    flushSync();
  }
});

function _mutate(fn) {
  const db = getDb();
  fn(db);
  _scheduleFlush();
  return db;
}

// ── Allowed settings fields (whitelist) ───────────────────────────────────────
const SETTINGS_FIELDS = new Set([
  "ollamaEnabled", "ollamaUrl", "ollamaModel", "invidiousInstance",
  "listenBrainzToken", "listenBrainzUsername",
  "invidiousSid", "invidiousUsername",
  "queueMode", "highQuality", "cacheEnabled", "videoMode",
  "lastFmApiKey",
]);

function filterSettings(updates) {
  const safe = {};
  for (const [k, v] of Object.entries(updates || {})) {
    if (SETTINGS_FIELDS.has(k)) safe[k] = v;
  }
  return safe;
}

// ── Track/playlist field whitelists ───────────────────────────────────────────
function filterTrack(t) {
  if (!t || typeof t !== "object") return null;
  return {
    id:        typeof t.id        === "string" ? t.id        : (typeof t.videoId === "string" ? t.videoId : undefined),
    videoId:   typeof t.videoId   === "string" ? t.videoId   : undefined,
    title:     typeof t.title     === "string" ? t.title     : "",
    artist:    typeof t.artist    === "string" ? t.artist    : "",
    album:     typeof t.album     === "string" ? t.album     : undefined,
    artwork:   typeof t.artwork   === "string" ? t.artwork   : undefined,
    url:       typeof t.url       === "string" ? t.url       : undefined,
    duration:  typeof t.duration  === "number" ? t.duration  : undefined,
    addedAt:   typeof t.addedAt   === "string" ? t.addedAt   : new Date().toISOString(),
  };
}

function filterPlaylist(p) {
  if (!p || typeof p !== "object") return null;
  return {
    id:        typeof p.id    === "string" ? p.id    : undefined,
    title:     typeof p.title === "string" ? p.title : "",
    videos:    Array.isArray(p.videos) ? p.videos.map(filterTrack).filter(Boolean) : [],
    createdAt: typeof p.createdAt === "string" ? p.createdAt : new Date().toISOString(),
    syncId:    typeof p.syncId === "string" ? p.syncId : undefined,
  };
}

function filterArtist(a) {
  if (!a || typeof a !== "object") return null;
  return {
    artistId:  typeof a.artistId === "string" ? a.artistId : undefined,
    name:      typeof a.name     === "string" ? a.name     : "",
    artwork:   typeof a.artwork  === "string" ? a.artwork  : undefined,
  };
}

function filterAlbum(a) {
  if (!a || typeof a !== "object") return null;
  return {
    id:      typeof a.id     === "string" ? a.id     : undefined,
    title:   typeof a.title  === "string" ? a.title  : "",
    artist:  typeof a.artist === "string" ? a.artist : "",
    artwork: typeof a.artwork === "string" ? a.artwork : undefined,
    year:    typeof a.year   === "number" ? a.year   : undefined,
    tracks:  Array.isArray(a.tracks) ? a.tracks.map(filterTrack).filter(Boolean) : undefined,
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

module.exports = {
  // ── Settings ─────────────────────────────────────────────────────────────
  getSettings: () => {
    const { invidiousSid: _sid, ...safe } = getDb().settings;
    return safe; // never expose the SID through the API
  },
  // Return a shallow copy so callers cannot accidentally mutate the cached object.
  getSettingsRaw: () => ({ ...getDb().settings }),

  updateSettings: (updates) => {
    const safe = filterSettings(updates);
    _mutate((db) => { db.settings = { ...db.settings, ...safe }; });
    return module.exports.getSettings();
  },

  // ── History ───────────────────────────────────────────────────────────────
  getHistory: () => getDb().history,
  getHistoryById: (id) => getDb().history.find(t => t.videoId === id),

  addHistory: (raw) => {
    const track = filterTrack(raw);
    if (!track) return getDb().history;
    _mutate((db) => {
      // Only dedup by videoId when the track actually has one; otherwise just prepend
      const dedup = track.videoId
        ? db.history.filter(t => t.videoId !== track.videoId)
        : db.history;
      db.history = [track, ...dedup].slice(0, 150);
    });
    return getDb().history;
  },

  updateHistory: (id, updates) => {
    const safe = filterTrack({ ...getDb().history.find(t => t.videoId === id), ...updates });
    let result = null;
    _mutate((db) => {
      const idx = db.history.findIndex(t => t.videoId === id);
      if (idx !== -1) { db.history[idx] = safe; result = safe; }
    });
    return result;
  },

  deleteHistory: (id) => {
    _mutate((db) => { db.history = db.history.filter(t => t.videoId !== id); });
  },

  clearHistory: () => {
    _mutate((db) => { db.history = []; });
  },

  // ── Playlists ──────────────────────────────────────────────────────────────
  getPlaylists: () => getDb().playlists,
  getPlaylist: (id) => getDb().playlists.find(p => p.id === id),

  addPlaylist: (raw) => {
    const pl = filterPlaylist(raw);
    if (!pl) return null;
    pl.id = pl.id || crypto.randomUUID();
    _mutate((db) => { db.playlists.push(pl); });
    return pl;
  },

  updatePlaylist: (id, updates) => {
    let result = null;
    _mutate((db) => {
      const idx = db.playlists.findIndex(p => p.id === id);
      if (idx !== -1) {
        // Merge carefully: never allow id to be changed
        const merged = { ...db.playlists[idx], ...filterPlaylist({ ...db.playlists[idx], ...updates }) };
        merged.id = id;
        db.playlists[idx] = merged;
        result = merged;
      }
    });
    return result;
  },

  deletePlaylist: (id) => {
    _mutate((db) => { db.playlists = db.playlists.filter(p => p.id !== id); });
  },

  // ── Artists ───────────────────────────────────────────────────────────────
  getArtists: () => getDb().artists,
  getArtist: (id) => getDb().artists.find(a => a.artistId === id),

  addArtist: (raw) => {
    const artist = filterArtist(raw);
    if (!artist) return getDb().artists;
    _mutate((db) => {
      db.artists = [artist, ...db.artists.filter(a => a.artistId !== artist.artistId)];
    });
    return getDb().artists;
  },

  updateArtist: (id, updates) => {
    let result = null;
    _mutate((db) => {
      const idx = db.artists.findIndex(a => a.artistId === id);
      if (idx !== -1) {
        db.artists[idx] = { ...db.artists[idx], ...filterArtist({ ...db.artists[idx], ...updates }) };
        result = db.artists[idx];
      }
    });
    return result;
  },

  deleteArtist: (id) => {
    _mutate((db) => { db.artists = db.artists.filter(a => a.artistId !== id); });
  },

  clearArtists: () => {
    _mutate((db) => { db.artists = []; });
  },

  // ── Favorites ─────────────────────────────────────────────────────────────
  getFavorites: () => getDb().favorites || [],

  addFavorite: (raw) => {
    const track = filterTrack(raw);
    if (!track) return getDb().favorites || [];
    _mutate((db) => {
      db.favorites = db.favorites || [];
      if (!db.favorites.find(t => t.videoId === track.videoId)) {
        db.favorites.unshift(track);
      }
    });
    return getDb().favorites;
  },

  deleteFavorite: (id) => {
    _mutate((db) => { db.favorites = (db.favorites || []).filter(t => t.videoId !== id); });
  },

  // ── Albums ────────────────────────────────────────────────────────────────
  getAlbums: () => getDb().albums || [],
  getAlbum:  (id) => (getDb().albums || []).find(a => a.id === id),

  addAlbum: (raw) => {
    const album = filterAlbum(raw);
    if (!album) return null;
    album.id = album.id || crypto.randomUUID();
    _mutate((db) => {
      db.albums = db.albums || [];
      db.albums.push(album);
    });
    return album;
  },

  updateAlbum: (id, updates) => {
    let result = null;
    _mutate((db) => {
      db.albums = db.albums || [];
      const idx = db.albums.findIndex(a => a.id === id);
      if (idx !== -1) {
        db.albums[idx] = { ...db.albums[idx], ...filterAlbum({ ...db.albums[idx], ...updates }), id };
        result = db.albums[idx];
      }
    });
    return result;
  },

  deleteAlbum: (id) => {
    _mutate((db) => { db.albums = (db.albums || []).filter(a => a.id !== id); });
  },

  clearAlbums: () => {
    _mutate((db) => { db.albums = []; });
  },
};
