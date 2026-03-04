/// <reference lib="webworker" />
/* eslint-disable no-restricted-globals */

/**
 * Elysium Service Worker
 *
 * Improvements over stock CRA SW:
 *  - Offline fallback page
 *  - Runtime caching for Invidious API responses (SWR, 5 min TTL, 50 entries)
 *  - Runtime caching for audio streams (CacheFirst, 10 entries)
 *  - Runtime caching for thumbnail images (CacheFirst, 200 entries, 7 days)
 *  - Push notification handling with action buttons
 *  - Notification click → focus / open app tab
 *  - Background sync for queued scrobbles (if browser supports it)
 */

import { clientsClaim } from "workbox-core";
import { ExpirationPlugin } from "workbox-expiration";
import {
  createHandlerBoundToURL,
  precacheAndRoute,
} from "workbox-precaching";
import { registerRoute } from "workbox-routing";
import {
  CacheFirst,
  NetworkFirst,
  StaleWhileRevalidate,
} from "workbox-strategies";
import { CacheableResponsePlugin } from "workbox-cacheable-response";
import { BackgroundSyncPlugin as WBBackgroundSyncPlugin } from "workbox-background-sync";

declare const self: ServiceWorkerGlobalScope;

clientsClaim();

// ── Precache CRA build manifest ───────────────────────────────────────────
precacheAndRoute(self.__WB_MANIFEST);

// ── App Shell (SPA navigation) ────────────────────────────────────────────
const fileExtensionRegexp = new RegExp("/[^/?]+\\.[^/]+$");
registerRoute(
  ({ request, url }: { request: Request; url: URL }) => {
    if (request.mode !== "navigate") return false;
    if (url.pathname.startsWith("/_")) return false;
    if (url.pathname.match(fileExtensionRegexp)) return false;
    return true;
  },
  createHandlerBoundToURL((process.env.PUBLIC_URL || "") + "/index.html"),
);

// ── Invidious API – NetworkFirst with 5-min cache ─────────────────────────
registerRoute(
  ({ url }) =>
    url.pathname.startsWith("/api/") ||
    url.hostname.includes("invidious") ||
    url.hostname.includes("inv.") ||
    url.pathname.startsWith("/v1/"),
  new NetworkFirst({
    cacheName: "api-cache",
    networkTimeoutSeconds: 8,
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({
        maxEntries: 50,
        maxAgeSeconds: 5 * 60, // 5 minutes
      }),
    ],
  }),
);

// ── Thumbnail / image caching ─────────────────────────────────────────────
registerRoute(
  ({ url }) =>
    url.pathname.match(/\.(png|jpg|jpeg|webp|gif|svg)$/) ||
    url.pathname.includes("/vi/") || // YouTube thumbnails
    url.pathname.includes("/thumbnail"),
  new CacheFirst({
    cacheName: "images",
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({
        maxEntries: 200,
        maxAgeSeconds: 7 * 24 * 60 * 60, // 7 days
      }),
    ],
  }),
);

// ── Audio stream caching (limited – streams can be large) ─────────────────
registerRoute(
  ({ url }) =>
    url.pathname.match(/\.(mp3|mp4|m4a|ogg|opus|webm)$/) ||
    url.pathname.includes("/latest_version"),
  new CacheFirst({
    cacheName: "audio-streams",
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200, 206] }),
      new ExpirationPlugin({
        maxEntries: 10,
        maxAgeSeconds: 24 * 60 * 60, // 1 day
      }),
    ],
  }),
);

// ── Google Fonts / external assets ────────────────────────────────────────
// Use NetworkFirst so fonts always load when online (avoids "no-response"
// service-worker errors when the cache is cold or expired).
registerRoute(
  ({ url }) =>
    url.origin === "https://fonts.googleapis.com" ||
    url.origin === "https://fonts.gstatic.com",
  new NetworkFirst({
    cacheName: "google-fonts",
    networkTimeoutSeconds: 5,
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({ maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 30 }),
    ],
  }),
);

// ── Background sync for queued scrobbles ──────────────────────────────────
// FIX: use static import; BackgroundSyncPlugin gracefully no-ops in unsupporting browsers.
let scrobbleQueue: WBBackgroundSyncPlugin | undefined;
try {
  scrobbleQueue = new WBBackgroundSyncPlugin("scrobble-queue", {
    maxRetentionTime: 24 * 60,
  });
} catch {
  console.warn("[SW] Background Sync not supported – scrobbles will not queue offline.");
  scrobbleQueue = undefined;
}

registerRoute(
  ({ url }) =>
    url.hostname === "api.listenbrainz.org" ||
    url.hostname === "ws.audioscrobbler.com",
  new NetworkFirst({
    cacheName: "scrobble-responses",
    plugins: scrobbleQueue ? [scrobbleQueue] : [],
    networkTimeoutSeconds: 10,
  }),
  "POST",
);

// ── Skip waiting (triggered by AppUpdate component) ───────────────────────
self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

// ── Push notification handler ──────────────────────────────────────────────
// Supports a richer "now playing" notification format:
// { title, body, icon, badge, url, track, artist, type }
// type="now-playing" renders media-control action buttons.
self.addEventListener("push", (event) => {
  let data: {
    title?: string;
    body?: string;
    icon?: string;
    badge?: string;
    url?: string;
    track?: string;
    artist?: string;
    type?: string;
  } = {};

  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data?.text() ?? "" };
  }

  const isNowPlaying = data.type === "now-playing";
  const title   = data.title  ?? (isNowPlaying ? (data.track ?? "Now Playing") : "Elysium");
  const body    = data.body   ?? (isNowPlaying && data.artist ? `by ${data.artist}` : "");
  const icon    = data.icon   ?? "/favicons/android/android-launchericon-192-192.png";
  const badge   = data.badge  ?? "/favicons/android/android-launchericon-72-72.png";

  const options: NotificationOptions = {
    body,
    icon,
    badge,
    // Use a stable tag so the notification replaces the previous one
    // instead of stacking (Android & iOS both respect this)
    tag: isNowPlaying ? "elysium-now-playing" : "elysium-notification",
    renotify: true,
    silent: isNowPlaying, // Don't make a sound for "now playing" updates
    // Keep the notification alive while the service worker is alive
    requireInteraction: false,
    data: {
      url:    data.url    ?? "/",
      track:  data.track  ?? null,
      artist: data.artist ?? null,
      type:   data.type   ?? "generic",
    },
    actions: isNowPlaying
      ? [
          { action: "prev",    title: "⏮ Previous" },
          { action: "toggle",  title: "⏸ Pause" },
          { action: "next",    title: "⏭ Next" },
        ]
      : [
          { action: "open",    title: "Open" },
          { action: "dismiss", title: "Dismiss" },
        ],
  } as NotificationOptions;

  event.waitUntil(self.registration.showNotification(title, options));
});

// ── Notification click handler ────────────────────────────────────────────
self.addEventListener("notificationclick", (event) => {
  const action  = event.action;
  const notifData = event.notification.data ?? {};

  event.notification.close();

  // For "now playing" control actions, post a message to all app clients
  // so the React app can respond (play/pause/next/prev) without opening a tab
  if (["prev", "toggle", "next"].includes(action)) {
    event.waitUntil(
      (self.clients as Clients)
        .matchAll({ type: "window", includeUncontrolled: true })
        .then((clientList) => {
          for (const client of clientList) {
            client.postMessage({ type: "NOTIFICATION_ACTION", action });
          }
          // If no client is open at all, open the app
          if (clientList.length === 0) {
            return (self.clients as Clients).openWindow(notifData.url ?? "/");
          }
        }),
    );
    return;
  }

  if (action === "dismiss") return;

  // Default: open / focus the app
  const targetUrl = notifData.url ?? "/";
  event.waitUntil(
    (self.clients as Clients)
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          if (client.url === targetUrl && "focus" in client) {
            return (client as WindowClient).focus();
          }
        }
        return (self.clients as Clients).openWindow(targetUrl);
      }),
  );
});
