<h1 align="center">Elysium</h1>
<p align="center">A self-hosted YouTube alternative PWA powered by the Invidious API</p>
<p align="center">
  <img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="MIT License" />
  <img src="https://img.shields.io/badge/Node.js-18+-green" alt="Node 18+" />
  <img src="https://img.shields.io/badge/Docker-ready-blue" alt="Docker" />
</p>

---

## Overview

Elysium is a privacy-respecting music and video PWA that uses [Invidious](https://github.com/iv-org/invidious) public instances as its backend — no Google account required. It supports playlists, favorites, real-time device sync, scrobbling, and more.

## Features

- 🔍 Search videos, playlists, and channels via Invidious or YouTube Music
- 🎵 Create and manage playlists
- ❤️ Save favorites
- 🔄 Real-time sync between devices (WebSocket/SSE)
- 🧹 SponsorBlock integration
- 📡 Last.fm & ListenBrainz scrobbling
- 🔔 Push notifications (optional, VAPID)
- 🌍 Internationalization: English, French, German, Japanese, Russian
- 📱 Responsive + installable as a PWA
- 🌙 Dark theme

## Stack

- [React 18](https://reactjs.org) + [TypeScript](https://www.typescriptlang.org/)
- [Mantine 7](https://mantine.dev) — UI components
- [React Query](https://react-query.tanstack.com/) — data fetching
- [React Router 6](https://reactrouter.com/) — routing
- [video.js](https://videojs.com/) — video playback
- [Workbox](https://developer.chrome.com/docs/workbox/) — PWA/service worker
- Express (server) + Node.js WebSocket (sync-server)

## Getting Started

### Local Development

**Requirements:** Node.js 18+

```bash
# 1. Clone
git clone git@github.com:just-for-death/elysium.git
cd elysium

# 2. Configure environment
cp .env.dist .env
# Edit .env — set REACT_APP_API_URL if using a remote API server

# 3. Install & run
npm install
npm start
```

App runs at `http://localhost:3000`.

### Docker (Recommended for self-hosting)

```bash
cp .env.dist .env
docker compose up -d
```

App available at `http://localhost:7771`. Change port with `PORT=8080 docker compose up -d`.

#### Services

| Service | Description | Default Port |
|---|---|---|
| `elysium` | React PWA + REST API | 7771 |
| `sync-server` | WebSocket/SSE real-time relay | internal (proxied) |

#### Optional: Push Notifications (VAPID)

```bash
docker run --rm node:20-alpine npx web-push generate-vapid-keys
```

Add keys to `.env` and uncomment the VAPID lines in `docker-compose.yml`.

## Environment Variables

See [`.env.dist`](.env.dist) for full reference.

| Variable | Description |
|---|---|
| `REACT_APP_API_URL` | API base URL (empty = same-origin) |
| `VAPID_PUBLIC_KEY` | Web Push public key (optional) |
| `VAPID_PRIVATE_KEY` | Web Push private key (optional) |
| `BROADCAST_SECRET` | Token to protect `/push/broadcast` |
| `ENABLE_HSTS` | `true` only behind HTTPS reverse proxy |

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
├── server/             # Express REST API
├── sync-server/        # Real-time WebSocket relay
├── public/             # Static assets & PWA manifest
├── docker-compose.yml
└── Dockerfile.build
```

## Scripts

```bash
npm start           # Dev server
npm run build       # Production build
npm run lint        # ESLint
npm run ts:check    # TypeScript type check
npm run format      # Prettier
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE)

## Inspiration

Elysium is inspired by [HoloPlay](https://github.com/stephane-r/holoplay-pwa), an open-source YouTube alternative PWA. Big thanks to the original project and its contributors.

