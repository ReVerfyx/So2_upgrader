# ============================================================================
#  Образ бэкенда STOCK2
#  Многоэтапная сборка: сборка TypeScript → минимальный образ для запуска
# ============================================================================
FROM node:20-alpine AS builder

WORKDIR /app

# Сначала манифесты — так слой с зависимостями кэшируется
COPY package.json package-lock.json ./
COPY backend/package.json ./backend/
COPY frontend/package.json ./frontend/

RUN npm ci --workspace backend --include-workspace-root

COPY backend ./backend
COPY migrations ./migrations

RUN npm run build --workspace backend

# ---------------------------------------------------------------------------
FROM node:20-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production

RUN apk add --no-cache tini && addgroup -S app && adduser -S app -G app

COPY package.json package-lock.json ./
COPY backend/package.json ./backend/
COPY frontend/package.json ./frontend/

RUN npm ci --workspace backend --include-workspace-root --omit=dev && npm cache clean --force

COPY --from=builder /app/backend/dist ./backend/dist
COPY migrations ./migrations

USER app
EXPOSE 4000

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "backend/dist/index.js"]
