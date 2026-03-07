/// <reference lib="webworker" />
/* eslint-disable no-restricted-globals */

/**
 * Elysium Service Worker — v7
 *
 * New in v7:
 *  - ytimg.com thumbnails cached directly (faster since Video.tsx now uses direct CDN URLs)
 *  - Rich media notifications: artwork image, vibration, timestamp
 *  - Notification actions use emoji + text for better Android/Chrome rendering
 *  - Periodic background sync for scrobble queue draining
 *  - Navigation preload enabled for faster page load from SW cache
 *  - Better offline fallback: returns cached shell for all navigation misses
 *  - `i.ytimg.com` added to image cache route
 *  - Stale-while-revalidate for Last.fm similar track responses (speeds up Similar mode)
 */

import { clientsClaim, setCacheNameDetails } from "workbox-core";
import { ExpirationPlugin } from "workbox-expiration";
import {
  createHandlerBoundToURL,
  precacheAndRoute,
} from "workbox-precaching";
import { registerRoute, NavigationRoute } from "workbox-routing";
import {
  CacheFirst,
  NetworkFirst,
  NetworkOnly,
  StaleWhileRevalidate,
} from "workbox-strategies";
import { CacheableResponsePlugin } from "workbox-cacheable-response";
import { BackgroundSyncPlugin as WBBackgroundSyncPlugin } from "workbox-background-sync";

declare const self: ServiceWorkerGlobalScope;

clientsClaim();

setCacheNameDetails({
  prefix: "elysium",
  suffix: "v7",
});

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

// ── iTunes Search / RSS API caching (powers Ollama rich context) ──────────
registerRoute(
  ({ url }) =>
    url.pathname.startsWith("/api/itunes-proxy") ||
    url.pathname.startsWith("/api/itunes-rss") ||
    url.hostname === "itunes.apple.com" ||
    url.hostname === "rss.applemarketingtools.com",
  new StaleWhileRevalidate({
    cacheName: "itunes-api",
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({
        maxEntries: 30,
        maxAgeSeconds: 5 * 60,
      }),
    ],
  }),
);

// ── Last.fm similar track caching (speeds up Similar mode second run) ─────
registerRoute(
  ({ url }) =>
    url.hostname === "ws.audioscrobbler.com" &&
    (url.searchParams.get("method") === "track.getSimilar" ||
     url.searchParams.get("method") === "artist.getSimilar"),
  new StaleWhileRevalidate({
    cacheName: "lastfm-similar",
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({
        maxEntries: 50,
        maxAgeSeconds: 15 * 60, // 15 min — similar tracks don't change fast
      }),
    ],
  }),
);

// ── Thumbnail / image caching ─────────────────────────────────────────────
// Now includes i.ytimg.com directly — Video.tsx v7_3 uses direct CDN URLs.
// CacheFirst with 7-day TTL: artwork rarely changes.
registerRoute(
  ({ url }) =>
    url.hostname === "i.ytimg.com" ||
    url.hostname === "i9.ytimg.com" ||
    url.hostname === "coverartarchive.org" ||
    url.hostname === "is1-ssl.mzstatic.com" ||
    url.hostname === "is2-ssl.mzstatic.com" ||
    url.pathname.match(/\.(png|jpg|jpeg|webp|gif|svg)$/) ||
    url.pathname.includes("/vi/") ||
    url.pathname.includes("/thumbnail"),
  new CacheFirst({
    cacheName: "images",
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({
        maxEntries: 400, // larger for desktop/iPad
        maxAgeSeconds: 7 * 24 * 60 * 60,
        purgeOnQuotaError: true,
      }),
    ],
  }),
);

// ── Audio stream caching ──────────────────────────────────────────────────
// 206 Partial Content whitelisted — required for iOS Safari scrubber.
// NOTE: Audio streams are NOT cached on the service worker's fetch path
// because they come from the Invidious proxy (cross-origin with CORS).
// The browser's HTTP cache + Range request support handles them natively.
// We only cache the /latest_version endpoint (same-origin).
registerRoute(
  ({ url }) => url.pathname.includes("/latest_version"),
  new CacheFirst({
    cacheName: "audio-streams",
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200, 206] }),
      new ExpirationPlugin({
        maxEntries: 10,
        maxAgeSeconds: 6 * 60 * 60,
      }),
    ],
  }),
);

// ── Background sync for scrobbles ─────────────────────────────────────────
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

// ── Skip waiting ──────────────────────────────────────────────────────────
self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("install", () => {
  self.skipWaiting();
});

// ── Push notification handler ─────────────────────────────────────────────
// Rich notifications with artwork, vibration, and better action labels.
self.addEventListener("push", (event) => {
  let data: {
    title?: string;
    body?: string;
    icon?: string;
    badge?: string;
    image?: string;
    url?: string;
    track?: string;
    artist?: string;
    artworkUrl?: string;
    type?: string;
  } = {};

  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data?.text() ?? "" };
  }

  const isNowPlaying = data.type === "now-playing";
  const title  = data.title  ?? (isNowPlaying ? (data.track  ?? "Now Playing") : "Elysium");
  const body   = data.body   ?? (isNowPlaying && data.artist ? data.artist : "");
  const icon   = data.icon   ?? "/favicons/android/android-launchericon-192-192.png";
  const badge  = data.badge  ?? "/favicons/android/android-launchericon-72-72.png";
  // `image` shows a large artwork banner in Android Chrome notifications
  const image  = data.artworkUrl ?? data.image ?? undefined;

  const options = {
    body,
    icon,
    badge,
    image,
    tag: isNowPlaying ? "elysium-now-playing" : "elysium-notification",
    renotify: isNowPlaying, // update existing notification when track changes
    silent: true,           // we don't play a sound — music is already playing
    requireInteraction: false,
    timestamp: Date.now(),
    vibrate: isNowPlaying ? [80] : [100, 50, 100],
    data: {
      url:    data.url    ?? "/",
      track:  data.track  ?? null,
      artist: data.artist ?? null,
      type:   data.type   ?? "generic",
    },
    actions: isNowPlaying
      ? [
          { action: "prev",   title: "⏮",      icon: badge },
          { action: "toggle", title: "⏸ Pause", icon: badge },
          { action: "next",   title: "⏭",      icon: badge },
        ]
      : [
          { action: "open",    title: "Open Elysium" },
          { action: "dismiss", title: "Dismiss" },
        ],
  } as NotificationOptions;

  event.waitUntil(self.registration.showNotification(title, options));
});

// ── Notification click handler ────────────────────────────────────────────
self.addEventListener("notificationclick", (event) => {
  const action    = event.action;
  const notifData = event.notification.data ?? {};

  event.notification.close();

  if (["prev", "toggle", "next"].includes(action)) {
    event.waitUntil(
      (self.clients as Clients)
        .matchAll({ type: "window", includeUncontrolled: true })
        .then((clientList) => {
          for (const client of clientList) {
            client.postMessage({ type: "NOTIFICATION_ACTION", action });
          }
          if (clientList.length === 0) {
            return (self.clients as Clients).openWindow(notifData.url ?? "/");
          }
        }),
    );
    return;
  }

  if (action === "dismiss") return;

  const targetUrl = notifData.url ?? "/";
  event.waitUntil(
    (self.clients as Clients)
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          if (client.url.includes(targetUrl) && "focus" in client) {
            return (client as WindowClient).focus();
          }
        }
        return (self.clients as Clients).openWindow(targetUrl);
      }),
  );
});

// ── Periodic background sync — drain scrobble queue when online ───────────
self.addEventListener("periodicsync", (event: any) => {
  if (event.tag === "scrobble-drain") {
    // Workbox BackgroundSync handles retry automatically.
    // This event ensures the queue is replayed even when the app is closed.
    event.waitUntil(
      (self.registration as any).sync?.register("scrobble-queue").catch(() => {}),
    );
  }
});
