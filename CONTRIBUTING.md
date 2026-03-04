# Contributing to Elysium

Thanks for taking the time to contribute! Here's how to get started.

## Development Setup

**Requirements:** Node.js 18+, Docker (optional)

```bash
# 1. Clone the repo
git clone git@github.com:just-for-death/elysium.git
cd elysium

# 2. Set up environment
cp .env.dist .env
# Edit .env with your values

# 3. Install dependencies
npm install

# 4. Start dev server
npm start
```

## Project Structure

```
elysium/
├── src/
│   ├── components/     # UI components
│   ├── containers/     # Layout-level components
│   ├── pages/          # Route-level pages
│   ├── services/       # API & external service integrations
│   ├── hooks/          # Custom React hooks
│   ├── providers/      # React context providers
│   ├── utils/          # Helper functions
│   ├── types/          # TypeScript interfaces
│   ├── database/       # Local DB & migrations
│   └── translations/   # i18n locale files
├── server/             # Express REST API (push notifications, country code)
├── sync-server/        # WebSocket/SSE real-time sync relay
├── public/             # Static assets & PWA manifest
├── docker-compose.yml  # Full stack Docker setup
└── Dockerfile.build    # Multi-stage production build
```

## Commit Style

This project uses [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add dark mode toggle
fix: resolve player crash on mobile
docs: update Docker setup instructions
chore: bump mantine to 7.12
```

## Pull Requests

- Fork the repo and create a branch from `main`
- Keep PRs focused — one feature or fix per PR
- Make sure `npm run lint` and `npm run ts:check` pass before submitting

## Reporting Issues

Please use [GitHub Issues](../../issues) and include steps to reproduce, expected vs actual behavior, and your environment (OS, browser, Node version).
