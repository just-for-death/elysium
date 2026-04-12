<h1 align="center">
  <img src="public/favicon.svg" width="48" height="48" alt="Elysium logo" /><br/>
  Elysium
</h1>

<p align="center">
  A self-hosted, privacy-respecting music PWA powered by the Invidious API
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-1.12.3-teal" alt="v1.12.3" />
  <img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="MIT License" />
  <img src="https://img.shields.io/badge/Node.js-20+-green" alt="Node 20+" />
  <img src="https://img.shields.io/badge/Docker-ready-blue" alt="Docker" />
  <img src="https://img.shields.io/docker/pulls/justxforxdocker/elysium" alt="Docker Pulls" />
</p>

---

## What is Elysium?

Elysium is a fully self-hosted YouTube music player built as a PWA (Progressive Web App). It uses [Invidious](https://github.com/iv-org/invidious) public instances as its backend — no Google account, no tracking, no ads. Install it on your phone or desktop and use it like a native app.

> 📱 **Native Apps Available:** If you prefer native, we have completely rebuilt the mobile experience! Check out the [Elysium Mobile Client](https://github.com/just-for-death/elysium-client) (built in Flutter for iOS and Android).

---

## Features

| Category | Feature |
|---|---|
| 🔍 **Search** | Search via Invidious or Apple Music, with filters for type, date, duration |
| 🎵 **Playlists** | Create local playlists, sync with Invidious account playlists |
| ❤️ **Library** | Favorites, history, followed artists, moods & genres |
| 🔄 **Sync** | Real-time cross-device sync over WebSocket — pause on one, resume on another |
| 🤖 **Auto-Queue** | Smart next-track engine with optional Ollama AI recommendations |
| 🎬 **Fullscreen Player** | Immersive fullscreen mode with album art blur and lyrics |
| 🧹 **SponsorBlock** | Skip sponsors, intros, outros, and more automatically |
| 📡 **Scrobbling** | ListenBrainz scrobbling + two-way playlist sync (Last.fm removed) |
| 🔔 **Push Notifications** | VAPID web push + Gotify self-hosted notifications |
| 🔑 **Invidious Account** | Login, manage and sync your Invidious cloud playlists |
| 📱 **PWA** | Installable on Android, iOS, and desktop with background sync |
| 🌍 **i18n** | English, French, German, Japanese, Russian |
| 🌙 **UI** | Teal dark theme, collapsible sidebar, bigger comfortable fonts |

---

## Quick Start — Docker Compose

```bash
# 1. Download the compose file
curl -O https://raw.githubusercontent.com/your-repo/elysium/main/docker-compose.yml

# 2. Start
docker compose up -d

# 3. Open in browser
http://localhost:7771
```

That's it. No build required — images are pulled from Docker Hub automatically.

---

## Update to Latest

```bash
docker compose pull && docker compose up -d
```

---

## Environment Variables

### Main app (`justxforxdocker/elysium`)

| Variable | Default | Description |
|---|---|---|
| `PORT` | `7771` | Host port |
| `SYNC_SERVER_URL` | `http://sync-server:3001` | Internal sync server URL |
| `VAPID_PUBLIC_KEY` | — | Web push public key |
| `VAPID_PRIVATE_KEY` | — | Web push private key |
| `VAPID_EMAIL` | — | `mailto:you@example.com` |
| `BROADCAST_SECRET` | — | Secret for push broadcast endpoint |
| `ENABLE_HSTS` | `false` | Set `true` if behind HTTPS reverse proxy |

### Sync server (`justxforxdocker/elysium-sync`)

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3001` | Internal port (not exposed) |
| `SYNC_TTL_MS` | `86400000` | Snapshot TTL (24h) |
| `LOG_LEVEL` | `info` | `debug` / `info` / `warn` / `error` |

### Generate VAPID keys

```bash
docker run --rm node:20-alpine npx web-push generate-vapid-keys
```

---

## Reverse Proxy (Nginx / Caddy)

**Caddy:**
```
elysium.yourdomain.com {
  reverse_proxy localhost:7771
}
```

**Nginx:**
```nginx
server {
    listen 443 ssl;
    server_name elysium.yourdomain.com;

    location / {
        proxy_pass http://localhost:7771;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

> WebSocket upgrade headers are required for real-time sync to work.

---

## Build from Source

```bash
git clone https://github.com/your-repo/elysium
cd elysium
docker compose -f docker-compose.build.yml up -d --build
```

---

## Docker Images

| Image | Description |
|---|---|
| [`justxforxdocker/elysium`](https://hub.docker.com/r/justxforxdocker/elysium) | Main PWA + REST server |
| [`justxforxdocker/elysium-sync`](https://hub.docker.com/r/justxforxdocker/elysium-sync) | Real-time WebSocket sync server |

---

## Architecture

```
Browser / PWA
     │
     ▼
justxforxdocker/elysium :7771
  ├── Serves built React PWA (static)
  ├── REST API: /api/push, /api/apple, /api/listenbrainz, /api/invidious
  └── Proxies /api/live/* ──► justxforxdocker/elysium-sync :3001
                                  └── WebSocket room manager
                                      (real-time device presence & sync)
```

---

## PWA Installation

**Android (Chrome/Firefox):** tap the browser menu → *Install App* or wait for the install banner to appear.

**iOS (Safari):** tap Share → *Add to Home Screen*.

**Desktop (Chrome/Edge):** click the install icon in the address bar.

Push notifications and background sync are supported on all platforms when installed as a PWA.

---

## Changelog — v1.12.3

- **Sync overhaul** — Rewritten WebSocket presence engine with reconnection handling and playlist sync IDs
- **Invidious account** — Login, view and sync your Invidious cloud playlists
- **Fullscreen player** — Immersive UI with blurred album art, lyrics overlay, native fullscreen API
- **Auto-queue** — Smart next-track selection; optional Ollama local AI recommendations
- **ListenBrainz playlist sync** — Two-way sync of playlists with your ListenBrainz account
- **CORS fix** — Server now sends correct headers so Firefox/IronFox works properly
- **UI redesign** — Settings and wifi/device indicator in header, collapsible sidebar, 15px base font
- **PWA improvements** — Install banner, background sync permission, better service worker
- **Removed** — Last.fm, legacy sync UI (ButtonSyncData, ModalSyncData, AppVersion)

---

## License

MIT © Elysium Contributors
