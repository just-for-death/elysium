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
registerRoute(
  ({ url }) =>
    url.origin === "https://fonts.googleapis.com" ||
    url.origin === "https://fonts.gstatic.com",
  new StaleWhileRevalidate({
    cacheName: "google-fonts",
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({ maxEntries: 20 }),
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

  // ── Cache recently played thumbnails & metadata for offline support ──────
  if (event.data?.type === "CACHE_RECENT_TRACKS") {
    const tracks: Array<{ thumbnailUrl?: string; audioUrl?: string }> =
      event.data.tracks ?? [];
    event.waitUntil(
      (async () => {
        const imageCache = await caches.open("images");
        const audioCache = await caches.open("audio-streams");

        for (const track of tracks) {
          if (track.thumbnailUrl) {
            try {
              const cached = await imageCache.match(track.thumbnailUrl);
              if (!cached) {
                const res = await fetch(track.thumbnailUrl, { mode: "no-cors" });
                if (res.ok || res.type === "opaque") {
                  await imageCache.put(track.thumbnailUrl, res);
                }
              }
            } catch {
              // ignore network errors
            }
          }
          if (track.audioUrl) {
            try {
              const cached = await audioCache.match(track.audioUrl);
              if (!cached) {
                const res = await fetch(track.audioUrl, { mode: "no-cors" });
                if (res.ok || res.type === "opaque") {
                  await audioCache.put(track.audioUrl, res);
                }
              }
            } catch {
              // ignore network errors
            }
          }
        }
      })(),
    );
  }
});

// ── Push notification handler ──────────────────────────────────────────────
self.addEventListener("push", (event) => {
  let data: {
    title?: string;
    body?: string;
    icon?: string;
    url?: string;
  } = {};

  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data?.text() ?? "" };
  }

  const title = data.title ?? "Elysium";
  // NotificationOptions in ServiceWorker scope omits actions/renotify; cast to satisfy showNotification
  const options = {
    body: data.body ?? "",
    icon: data.icon ?? "/favicons/android/android-launchericon-192-192.png",
    badge: "/favicons/android/android-launchericon-72-72.png",
    tag: "elysium-notification",
    renotify: true,
    data: { url: data.url ?? "/" },
    actions: [
      { action: "open", title: "Open" },
      { action: "dismiss", title: "Dismiss" },
    ],
  } as NotificationOptions;

  event.waitUntil(self.registration.showNotification(title, options));
});

// ── Notification click handler ────────────────────────────────────────────
self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  if (event.action === "dismiss") return;

  const targetUrl = event.notification.data?.url ?? "/";

  event.waitUntil(
    (self.clients as Clients)
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        // Focus an existing tab if one is already open
        for (const client of clientList) {
          if (client.url === targetUrl && "focus" in client) {
            return (client as WindowClient).focus();
          }
        }
        // Otherwise open a new tab
        return (self.clients as Clients).openWindow(targetUrl);
      }),
  );
});
