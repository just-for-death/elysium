/**
 * Gotify notification service
 * Gotify is a self-hosted push notification server.
 * Docs: https://gotify.net/docs/
 *
 * WHY A PROXY?
 * Calling Gotify directly from the browser fails for two reasons:
 *   1. Firefox's HTTPS-Only Mode silently upgrades http:// → https://, which
 *      breaks plain-HTTP LAN Gotify servers (SSL handshake fails).
 *   2. CORS: browsers block cross-origin requests to private IPs unless the
 *      server sets the appropriate Access-Control-Allow-* headers (Gotify
 *      doesn't by default).
 * The fix: POST to /api/gotify-proxy (same origin as Elysium, already HTTPS),
 * and let the Node server forward the request to Gotify over plain HTTP where
 * neither restriction applies.
 */

import { log } from "../utils/logger";

export interface GotifyMessage {
  title: string;
  message: string;
  priority?: number; // 1 = low, 5 = normal, 8 = high
  extras?: {
    "client::display"?: { contentType?: "text/markdown" | "text/plain" };
    "client::notification"?: { bigImageUrl?: string; click?: { url?: string } };
    [key: string]: unknown;
  };
}

/**
 * Send a notification to a Gotify server via the server-side proxy.
 * Returns true on success.
 */
export const sendGotifyNotification = async (
  serverUrl: string,
  token: string,
  msg: GotifyMessage,
): Promise<boolean> => {
  if (!serverUrl || !token) return false;
  try {
    const res = await fetch("/api/gotify-proxy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        serverUrl,
        token,
        payload: {
          title: msg.title,
          message: msg.message,
          priority: msg.priority ?? 5,
          ...(msg.extras ? { extras: msg.extras } : {}),
        },
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      log.warn("Gotify notification failed", { status: res.status });
    }
    return res.ok;
  } catch (err) {
    log.warn("Gotify notification error", { err });
    return false;
  }
};

/**
 * Test the Gotify connection by sending a test message.
 */
export const testGotifyConnection = async (
  serverUrl: string,
  token: string,
): Promise<{ ok: boolean; error?: string }> => {
  if (!serverUrl || !token) {
    return { ok: false, error: "Server URL and token are required" };
  }
  try {
    const ok = await sendGotifyNotification(serverUrl, token, {
      title: "🎵 Elysium",
      message: "Gotify connected successfully! You'll receive new release alerts here.",
      priority: 3,
    });
    return ok ? { ok: true } : { ok: false, error: "Server returned an error — check your token and URL" };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
};

/**
 * Send a new music release alert to Gotify.
 */
export const sendNewReleaseAlert = async (
  serverUrl: string,
  token: string,
  artistName: string,
  releaseName: string,
  artworkUrl?: string,
): Promise<void> => {
  await sendGotifyNotification(serverUrl, token, {
    title: `🎵 New release: ${artistName}`,
    message: `**${artistName}** just dropped **${releaseName}**`,
    priority: 6,
    extras: {
      "client::display": { contentType: "text/markdown" },
      ...(artworkUrl
        ? { "client::notification": { bigImageUrl: artworkUrl } }
        : {}),
    },
  });
};
