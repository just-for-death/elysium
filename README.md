<h1 align="center">Elysium</h1>
<p align="center">A self-hosted, privacy-respecting YouTube alternative PWA powered by the Invidious API</p>
<p align="center">
  <img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="MIT License" />
  <img src="https://img.shields.io/badge/Node.js-18+-green" alt="Node 18+" />
  <img src="https://img.shields.io/badge/Docker-ready-blue" alt="Docker" />
  <img src="https://img.shields.io/docker/pulls/justxforxdocker/elysium" alt="Docker Pulls" />
</p>

---

## Overview

Elysium is a music and video PWA that uses [Invidious](https://github.com/iv-org/invidious) public instances as its backend — no Google account, no tracking, no ads. You can search YouTube content, manage playlists and favorites, scrobble to Last.fm and ListenBrainz, sync listening state across devices in real time, and receive push notifications for new releases via Gotify.

---

## Features

- 🔍 Search videos, playlists and channels via Invidious or YouTube Music
- 🎵 Create and manage local playlists
- ❤️ Save favorites
- 🔄 Real-time sync between devices (WebSocket/SSE)
- 🧹 SponsorBlock — skip sponsors, intros, outros automatically
- 📡 Last.fm & ListenBrainz scrobbling
- 🔔 Push notifications via VAPID or Gotify (self-hosted)
- 🔑 Invidious account login + playlist sync
- 🌍 Internationalization: English, French, German, Japanese, Russian
- 📱 Responsive + installable as a PWA
- 🌙 Dark theme

---

## Quick Start (Docker)

The fastest way to run Elysium — pulls pre-built images from Docker Hub:

```bash
# 1. Download the compose file
curl -O https://raw.githubusercontent.com/just-for-death/elysium/main/docker-compose.yml

# 2. Start
docker compose up -d
```

App is available at **http://localhost:7771**

To change the port:
```bash
PORT=8080 docker compose up -d
```

---

## Docker Images

| Image | Description |
|---|---|
| `justxforxdocker/elysium:latest` | React PWA + Express API server |
| `justxforxdocker/elysium-sync:latest` | Real-time WebSocket/SSE sync relay |

```bash
docker pull justxforxdocker/elysium:latest
docker pull justxforxdocker/elysium-sync:latest
```

---

## Local Development

**Requirements:** Node.js 18+

```bash
git clone git@github.com:just-for-death/elysium.git
cd elysium
cp .env.dist .env
npm install
npm start
```

App runs at `http://localhost:3000`.

---

## Build from Source (Docker)

Use `docker-compose.build.yml` to build images locally instead of pulling from Docker Hub:

```bash
docker compose -f docker-compose.build.yml up -d --build
```

---

## Integrations

### 🎵 ListenBrainz

[ListenBrainz](https://listenbrainz.org) is a free, open-source music scrobbling service by the MetaBrainz Foundation.

**What Elysium does:**
- Submits a "playing now" status when you start a track
- Scrobbles the track after sufficient playback time
- Syncs your local playlists to ListenBrainz (JSPF format)
- Imports ListenBrainz playlists back into Elysium
- Shows your listening stats and top tracks
- Resolves ListenBrainz recommendations to playable YouTube videos via Invidious

**Setup:**
1. Create a free account at [listenbrainz.org](https://listenbrainz.org)
2. Go to **Profile → User Token** and copy your token
3. In Elysium open **Settings → ListenBrainz**
4. Paste your token and click **Validate**

---

### 🔔 Gotify

[Gotify](https://gotify.net) is a self-hosted push notification server. Elysium uses it to send alerts when a followed artist releases new music.

**What Elysium does:**
- Sends a push notification to your Gotify server when a new release is detected for a followed artist
- Notifications include artist name, release title, and album art
- All requests are proxied through Elysium's backend (avoids CORS and HTTPS-only browser restrictions on LAN servers)

**Setup:**
1. Self-host Gotify — see [gotify.net/docs](https://gotify.net/docs/install)
2. In Gotify create an **App** and copy its token
3. In Elysium open **Settings → Gotify**
4. Enter your Gotify server URL (e.g. `http://192.168.1.10:8080`) and the app token
5. Click **Test Connection** to verify

---

### 🔑 Invidious Account

Logging into an Invidious instance lets you sync your Elysium playlists with your Invidious account, so they're accessible from any Invidious frontend.

**What Elysium does:**
- Logs into your Invidious account using username/password (session handled server-side)
- Fetches your existing Invidious playlists
- Pushes local Elysium playlists to Invidious
- Adds/removes individual videos from Invidious playlists

**Setup:**
1. Create an account on any public Invidious instance (e.g. [inv.nadeko.net](https://inv.nadeko.net))
2. In Elysium open **Settings → Invidious Account**
3. Enter your instance URL, username and password
4. Click **Login** — your playlists will appear

> **Note:** Elysium logs in through a server-side proxy so your credentials never leave your own server.

---

## Environment Variables

See [`.env.dist`](.env.dist) for the full reference.

| Variable | Description | Default |
|---|---|---|
| `PORT` | External port for the PWA | `7771` |
| `REACT_APP_API_URL` | API base URL (empty = same-origin) | `` |
| `VAPID_PUBLIC_KEY` | Web Push public key | optional |
| `VAPID_PRIVATE_KEY` | Web Push private key | optional |
| `VAPID_EMAIL` | Contact email for push service | optional |
| `BROADCAST_SECRET` | Token to protect `/push/broadcast` | optional |
| `ENABLE_HSTS` | Set `true` only behind HTTPS reverse proxy | `false` |
| `SYNC_LOG_LEVEL` | Sync server log level: `debug\|info\|warn\|error` | `info` |

### Generating VAPID keys (optional, for push notifications)

```bash
docker run --rm node:20-alpine npx web-push generate-vapid-keys
```

---

## Project Structure

```
elysium/
├── src/
│   ├── components/     # UI components
│   ├── containers/     # Layout-level components
│   ├── pages/          # Route-level pages
│   ├── services/       # API & external integrations
│   ├── hooks/          # Custom React hooks
│   ├── providers/      # React context providers
│   ├── utils/          # Helpers & formatters
│   ├── types/          # TypeScript interfaces
│   ├── database/       # LocalStorage DB & migrations
│   └── translations/   # i18n locale files
├── server/             # Express REST API + proxy endpoints
├── sync-server/        # Real-time WebSocket/SSE relay
├── public/             # Static assets & PWA manifest
├── docker-compose.yml           # Production (pulls from Docker Hub)
├── docker-compose.build.yml     # Build from source
└── Dockerfile.build             # Multi-stage production build
```

---

## Scripts

```bash
npm start           # Dev server
npm run build       # Production build
npm run lint        # ESLint
npm run ts:check    # TypeScript type check
npm run format      # Prettier
```

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

---

## License

[MIT](LICENSE)

---

## Inspiration

Elysium is inspired by [HoloPlay](https://github.com/stephane-r/holoplay-pwa), an open-source YouTube alternative PWA. Big thanks to the original project and its contributors.
