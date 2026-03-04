// Last.fm Scrobbling Service
// Uses Last.fm API v2 with MD5 signature authentication

const LASTFM_API_URL = "https://ws.audioscrobbler.com/2.0/";

function md5(str: string): string {
  // Simple MD5 implementation for browser
  // Using SubtleCrypto is async, so we implement a sync md5 here
  function safeAdd(x: number, y: number): number {
    const lsw = (x & 0xffff) + (y & 0xffff);
    const msw = (x >> 16) + (y >> 16) + (lsw >> 16);
    return (msw << 16) | (lsw & 0xffff);
  }
  function bitRotateLeft(num: number, cnt: number): number {
    return (num << cnt) | (num >>> (32 - cnt));
  }
  function md5cmn(q: number, a: number, b: number, x: number, s: number, t: number) {
    return safeAdd(bitRotateLeft(safeAdd(safeAdd(a, q), safeAdd(x, t)), s), b);
  }
  function md5ff(a: number, b: number, c: number, d: number, x: number, s: number, t: number) {
    return md5cmn((b & c) | (~b & d), a, b, x, s, t);
  }
  function md5gg(a: number, b: number, c: number, d: number, x: number, s: number, t: number) {
    return md5cmn((b & d) | (c & ~d), a, b, x, s, t);
  }
  function md5hh(a: number, b: number, c: number, d: number, x: number, s: number, t: number) {
    return md5cmn(b ^ c ^ d, a, b, x, s, t);
  }
  function md5ii(a: number, b: number, c: number, d: number, x: number, s: number, t: number) {
    return md5cmn(c ^ (b | ~d), a, b, x, s, t);
  }

  function md5blks(s: string): number[] {
    const md5blks: number[] = [];
    for (let i = 0; i < 64 * Math.ceil((s.length + 8) / 64); i += 4) {
      md5blks[i >> 2] = s.charCodeAt(i) + (s.charCodeAt(i + 1) << 8) + (s.charCodeAt(i + 2) << 16) + (s.charCodeAt(i + 3) << 24);
    }
    md5blks[s.length >> 2] |= 0x80 << (s.length % 4 * 8);
    md5blks[14 + (((s.length + 8) >> 6) << 4)] = s.length * 8;
    return md5blks;
  }

  const blks = md5blks(str);
  let a = 1732584193, b = -271733879, c = -1732584194, d = 271733878;
  for (let i = 0; i < blks.length; i += 16) {
    const olda = a, oldb = b, oldc = c, oldd = d;
    a = md5ff(a, b, c, d, blks[i], 7, -680876936);
    d = md5ff(d, a, b, c, blks[i + 1], 12, -389564586);
    c = md5ff(c, d, a, b, blks[i + 2], 17, 606105819);
    b = md5ff(b, c, d, a, blks[i + 3], 22, -1044525330);
    a = md5ff(a, b, c, d, blks[i + 4], 7, -176418897);
    d = md5ff(d, a, b, c, blks[i + 5], 12, 1200080426);
    c = md5ff(c, d, a, b, blks[i + 6], 17, -1473231341);
    b = md5ff(b, c, d, a, blks[i + 7], 22, -45705983);
    a = md5ff(a, b, c, d, blks[i + 8], 7, 1770035416);
    d = md5ff(d, a, b, c, blks[i + 9], 12, -1958414417);
    c = md5ff(c, d, a, b, blks[i + 10], 17, -42063);
    b = md5ff(b, c, d, a, blks[i + 11], 22, -1990404162);
    a = md5ff(a, b, c, d, blks[i + 12], 7, 1804603682);
    d = md5ff(d, a, b, c, blks[i + 13], 12, -40341101);
    c = md5ff(c, d, a, b, blks[i + 14], 17, -1502002290);
    b = md5ff(b, c, d, a, blks[i + 15], 22, 1236535329);
    a = md5gg(a, b, c, d, blks[i + 1], 5, -165796510);
    d = md5gg(d, a, b, c, blks[i + 6], 9, -1069501632);
    c = md5gg(c, d, a, b, blks[i + 11], 14, 643717713);
    b = md5gg(b, c, d, a, blks[i], 20, -373897302);
    a = md5gg(a, b, c, d, blks[i + 5], 5, -701558691);
    d = md5gg(d, a, b, c, blks[i + 10], 9, 38016083);
    c = md5gg(c, d, a, b, blks[i + 15], 14, -660478335);
    b = md5gg(b, c, d, a, blks[i + 4], 20, -405537848);
    a = md5gg(a, b, c, d, blks[i + 9], 5, 568446438);
    d = md5gg(d, a, b, c, blks[i + 14], 9, -1019803690);
    c = md5gg(c, d, a, b, blks[i + 3], 14, -187363961);
    b = md5gg(b, c, d, a, blks[i + 8], 20, 1163531501);
    a = md5gg(a, b, c, d, blks[i + 13], 5, -1444681467);
    d = md5gg(d, a, b, c, blks[i + 2], 9, -51403784);
    c = md5gg(c, d, a, b, blks[i + 7], 14, 1735328473);
    b = md5gg(b, c, d, a, blks[i + 12], 20, -1926607734);
    a = md5hh(a, b, c, d, blks[i + 5], 4, -378558);
    d = md5hh(d, a, b, c, blks[i + 8], 11, -2022574463);
    c = md5hh(c, d, a, b, blks[i + 11], 16, 1839030562);
    b = md5hh(b, c, d, a, blks[i + 14], 23, -35309556);
    a = md5hh(a, b, c, d, blks[i + 1], 4, -1530992060);
    d = md5hh(d, a, b, c, blks[i + 4], 11, 1272893353);
    c = md5hh(c, d, a, b, blks[i + 7], 16, -155497632);
    b = md5hh(b, c, d, a, blks[i + 10], 23, -1094730640);
    a = md5hh(a, b, c, d, blks[i + 13], 4, 681279174);
    d = md5hh(d, a, b, c, blks[i], 11, -358537222);
    c = md5hh(c, d, a, b, blks[i + 3], 16, -722521979);
    b = md5hh(b, c, d, a, blks[i + 6], 23, 76029189);
    a = md5hh(a, b, c, d, blks[i + 9], 4, -640364487);
    d = md5hh(d, a, b, c, blks[i + 12], 11, -421815835);
    c = md5hh(c, d, a, b, blks[i + 15], 16, 530742520);
    b = md5hh(b, c, d, a, blks[i + 2], 23, -995338651);
    a = md5ii(a, b, c, d, blks[i], 6, -198630844);
    d = md5ii(d, a, b, c, blks[i + 7], 10, 1126891415);
    c = md5ii(c, d, a, b, blks[i + 14], 15, -1416354905);
    b = md5ii(b, c, d, a, blks[i + 5], 21, -57434055);
    a = md5ii(a, b, c, d, blks[i + 12], 6, 1700485571);
    d = md5ii(d, a, b, c, blks[i + 3], 10, -1894986606);
    c = md5ii(c, d, a, b, blks[i + 10], 15, -1051523);
    b = md5ii(b, c, d, a, blks[i + 1], 21, -2054922799);
    a = md5ii(a, b, c, d, blks[i + 8], 6, 1873313359);
    d = md5ii(d, a, b, c, blks[i + 15], 10, -30611744);
    c = md5ii(c, d, a, b, blks[i + 6], 15, -1560198380);
    b = md5ii(b, c, d, a, blks[i + 13], 21, 1309151649);
    a = md5ii(a, b, c, d, blks[i + 4], 6, -145523070);
    d = md5ii(d, a, b, c, blks[i + 11], 10, -1120210379);
    c = md5ii(c, d, a, b, blks[i + 2], 15, 718787259);
    b = md5ii(b, c, d, a, blks[i + 9], 21, -343485551);
    a = safeAdd(a, olda);
    b = safeAdd(b, oldb);
    c = safeAdd(c, oldc);
    d = safeAdd(d, oldd);
  }

  const hex = [a, b, c, d];
  return hex.map(n => {
    let s = "";
    for (let j = 0; j < 4; j++) {
      s += ("0" + ((n >> (j * 8)) & 0xff).toString(16)).slice(-2);
    }
    return s;
  }).join("");
}

export interface LastfmCredentials {
  apiKey: string;
  apiSecret: string;
  sessionKey: string;
  username: string;
}

export interface LastfmAuthResult {
  token: string;
}

export interface LastfmSessionResult {
  session: {
    name: string;
    key: string;
    subscriber: string;
  };
}

// Build API signature for authenticated calls
function buildSignature(params: Record<string, string>, secret: string): string {
  const sorted = Object.keys(params)
    .sort()
    .map(key => `${key}${params[key]}`)
    .join("");
  return md5(sorted + secret);
}

// Get a token (step 1 of auth)
export async function getLastfmToken(apiKey: string): Promise<string> {
  const url = `${LASTFM_API_URL}?method=auth.gettoken&api_key=${apiKey}&format=json`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.error) throw new Error(data.message);
  return data.token;
}

// Get auth URL to redirect user to
export function getLastfmAuthUrl(apiKey: string, token: string): string {
  return `https://www.last.fm/api/auth/?api_key=${apiKey}&token=${token}`;
}

// Get session key after user has authorized (step 3)
export async function getLastfmSession(
  apiKey: string,
  apiSecret: string,
  token: string
): Promise<LastfmSessionResult["session"]> {
  const params: Record<string, string> = {
    method: "auth.getSession",
    api_key: apiKey,
    token,
  };
  const sig = buildSignature(params, apiSecret);
  const url = `${LASTFM_API_URL}?method=auth.getSession&api_key=${apiKey}&token=${token}&api_sig=${sig}&format=json`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.error) throw new Error(data.message);
  return data.session;
}

// Update "Now Playing" on Last.fm
export async function updateNowPlaying(
  credentials: LastfmCredentials,
  track: string,
  artist: string,
  duration?: number
): Promise<void> {
  const params: Record<string, string> = {
    method: "track.updateNowPlaying",
    api_key: credentials.apiKey,
    sk: credentials.sessionKey,
    artist,
    track,
    ...(duration ? { duration: String(Math.round(duration)) } : {}),
  };
  const sig = buildSignature(params, credentials.apiSecret);

  const body = new URLSearchParams({
    ...params,
    api_sig: sig,
    format: "json",
  });

  const res = await fetch(LASTFM_API_URL, {
    method: "POST",
    body,
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });
  const data = await res.json();
  if (data.error) console.warn("[Last.fm] Now Playing error:", data.message);
}

// Scrobble a track to Last.fm
export async function scrobbleTrack(
  credentials: LastfmCredentials,
  track: string,
  artist: string,
  timestamp: number,
  duration?: number
): Promise<void> {
  const params: Record<string, string> = {
    method: "track.scrobble",
    api_key: credentials.apiKey,
    sk: credentials.sessionKey,
    artist,
    track,
    timestamp: String(timestamp),
    ...(duration ? { duration: String(Math.round(duration)) } : {}),
  };
  const sig = buildSignature(params, credentials.apiSecret);

  const body = new URLSearchParams({
    ...params,
    api_sig: sig,
    format: "json",
  });

  const res = await fetch(LASTFM_API_URL, {
    method: "POST",
    body,
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });
  const data = await res.json();
  if (data.error) console.warn("[Last.fm] Scrobble error:", data.message);
}

// Parse video title into artist/track (best-effort heuristic)
export function parseArtistTrack(title: string, author: string): { artist: string; track: string } {
  // Common formats: "Artist - Track", "Artist – Track", "Artist: Track"
  const separators = [" - ", " – ", " — ", ": "];
  for (const sep of separators) {
    if (title.includes(sep)) {
      const idx = title.indexOf(sep);
      return {
        artist: title.slice(0, idx).trim(),
        track: title.slice(idx + sep.length).trim(),
      };
    }
  }
  // Fall back to channel name as artist
  return { artist: author, track: title };
}
