// @ts-ignore
import localStorageDB from "localstoragedb";
import { v4 as uuidv4 } from "uuid";

import { sponsorBlockCategoriesValues } from "../components/SponsorBlockSettings";
import type { Settings } from "../types/interfaces/Settings";

const DB_NAME = "library";

const initDb = (isRetry = false) => {
  let db: ReturnType<typeof localStorageDB>;
  try {
    db = new localStorageDB(DB_NAME, localStorage) as ReturnType<typeof localStorageDB>;
  } catch (err) {
    if (isRetry) throw err;
    console.warn("[elysium] DB init failed, clearing and retrying:", err);
    localStorage.removeItem(`db_${DB_NAME}`);
    return initDb(true);
  }

  if (db.isNew()) {
    db.createTable("playlists", [
      "playlistId",
      "createdAt",
      "title",
      "cards",
      "videos",
      "videoCount",
      "type",
    ]);
    db.createTable("settings", [
      "createdAt",
      "currentInstance",
      "defaultInstance",
      "customInstances",
      "devices",
    ]);

    db.insert("playlists", {
      createdAt: new Date().toISOString(),
      title: "Favorites",
      cards: [],
    });

    db.insert("playlists", {
      createdAt: new Date().toISOString(),
      title: "Cache",
      videos: [],
      videoCount: 0,
      type: "cache",
    });
    db.insert("settings", {
      createdAt: new Date().toISOString(),
      currentInstance: null,
      defaultInstance: null,
      customInstances: [],
      devices: [],
    });

    db.commit();
  }

  if (!db.tableExists("history")) {
    db.createTable("history", [
      "videoThumbnails",
      "description",
      "formatStreams",
      "lengthSeconds",
      "title",
      "type",
      "videoId",
    ]);
  }

  if (!db.tableExists("searchHistory")) {
    db.createTable("searchHistory", ["createdAt", "term"]);
  }

  if (!db.columnExists("settings", "defaultInstance")) {
    db.alterTable("settings", "defaultInstance");
    db.commit();
  }

  if (!db.columnExists("settings", "customInstances")) {
    db.alterTable("settings", "customInstances");
    db.commit();
  }

  if (!db.columnExists("settings", "videoMode")) {
    db.alterTable("settings", "videoMode", true);
    db.commit();
  }

  if (!db.columnExists("settings", "deviceId")) {
    db.alterTable("settings", "deviceId", uuidv4());
    db.commit();
  }

  if (!db.columnExists("settings", "linkedDevices")) {
    db.alterTable("settings", "linkedDevices", []);
    db.commit();
  }

  if (!db.columnExists("settings", "deviceName")) {
    db.alterTable("settings", "deviceName", "");
    db.commit();
  }

  if (!db.columnExists("settings", "sponsorBlock")) {
    db.alterTable("settings", "sponsorBlock", true);
    db.alterTable("settings", "sponsorBlockCategories");
    db.commit();

    db.update("settings", { ID: 1 }, (data: Settings) => ({
      sponsorBlockCategories: sponsorBlockCategoriesValues.map(
        (category) => category.value,
      ),
    }));
    db.commit();
  }

  if (!db.columnExists("settings", "exportFileName")) {
    db.alterTable("settings", "exportFileName", "");
    db.commit();
  }

  if (!db.columnExists("settings", "exportLastDate")) {
    db.alterTable("settings", "exportLastDate", "");
    db.commit();
  }

  if (!db.columnExists("settings", "analytics")) {
    db.alterTable("settings", "analytics", true);
    db.commit();

    db.update("settings", { ID: 1 }, (data: Settings) => ({
      analytics: true,
    }));
    db.commit();
  }

  if (!db.columnExists("settings", "devices")) {
    db.alterTable("settings", "devices", []);
    db.commit();
  }

  if (!db.columnExists("settings", "listenBrainzToken")) {
    try {
      // Use object form: localStorageDB throws when default is null
      db.alterTable(
        "settings",
        ["listenBrainzToken", "listenBrainzUsername", "listenBrainzEnabled", "listenBrainzPlayingNow"],
        {
          listenBrainzToken: "",
          listenBrainzUsername: "",
          listenBrainzEnabled: false,
          listenBrainzPlayingNow: true,
        }
      );
      db.commit();
    } catch (err) {
      if (isRetry) throw err;
      console.warn("[elysium] ListenBrainz migration failed, resetting DB:", err);
      localStorage.removeItem(`db_${DB_NAME}`);
      return initDb(true);
    }
  }

  if (!db.tableExists("migrations")) {
    db.createTable("migrations", ["createdAt", "name"]);
  }

  // Ensure the Cache system playlist exists for existing users
  const cacheExists = db.queryAll("playlists", { query: { title: "Cache" } });
  if (!cacheExists || cacheExists.length === 0) {
    db.insert("playlists", {
      createdAt: new Date().toISOString(),
      title: "Cache",
      videos: [],
      videoCount: 0,
      type: "cache",
    });
    db.commit();
  }

  // Followed artists table
  if (!db.tableExists("followedArtists")) {
    db.createTable("followedArtists", [
      "artistId",
      "name",
      "thumbnail",
      "platform",
      "itunesId",
      "followedAt",
      "lastSeenReleaseName",
      "lastSeenReleaseDate",
    ]);
    db.commit();
  }

  // Gotify settings columns
  if (!db.columnExists("settings", "gotifyUrl")) {
    db.alterTable("settings", "gotifyUrl", "");
    db.alterTable("settings", "gotifyToken", "");
    db.alterTable("settings", "gotifyEnabled", false);
    db.commit();
  }

  // Multi-device sync
  if (!db.columnExists("settings", "syncEnabled")) {
    db.alterTable("settings", "syncEnabled", false);
    db.alterTable("settings", "syncInterval", 30); // minutes between auto-syncs
    db.alterTable("settings", "lastSyncAt", "");
    db.commit();
  }


  // Invidious account columns
  if (!db.columnExists("settings", "invidiousToken")) {
    db.alterTable("settings", "invidiousToken", "");
    db.alterTable("settings", "invidiousUsername", "");
    db.alterTable("settings", "invidiousLoginInstance", "");
    db.commit();
  }
  // invidiousSid replaces invidiousToken (stores raw SID, not a Bearer token)
  if (!db.columnExists("settings", "invidiousSid")) {
    db.alterTable("settings", "invidiousSid", "");
    db.commit();
  }
  // Auto-push toggle
  if (!db.columnExists("settings", "invidiousAutoPush")) {
    db.alterTable("settings", "invidiousAutoPush", false);
    db.commit();
  }

  // Invidious playlist mapping (local ID → invidious playlist ID)
  if (!db.columnExists("settings", "invidiousPlaylistMappings")) {
    db.alterTable("settings", "invidiousPlaylistMappings", {});
    db.commit();
  }

  return db;
};

let db: ReturnType<typeof initDb>;
try {
  db = initDb();
  require("./migrations");
} catch (err) {
  console.error("[elysium] Database init failed:", err);
  localStorage.removeItem(`db_${DB_NAME}`);
  db = initDb(true);
  try {
    require("./migrations");
  } catch (migrationErr) {
    console.warn("[elysium] Migrations failed:", migrationErr);
  }
}

export { db };
