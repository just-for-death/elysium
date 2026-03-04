# syntax=docker/dockerfile:1
# ── Elysium Sync Server ──────────────────────────────────────────────────────

FROM node:20-alpine

RUN addgroup -S elysium-sync && adduser -S elysium-sync -G elysium-sync

WORKDIR /app

COPY package.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm install --omit=dev --ignore-scripts

COPY index.js ./

RUN chown -R elysium-sync:elysium-sync /app
USER elysium-sync

EXPOSE 3001

HEALTHCHECK --interval=20s --timeout=5s --start-period=8s --retries=3 \
  CMD wget -qO- http://localhost:3001/health || exit 1

CMD ["node", "index.js"]
