# ============================================================================
#  STOCK2 — единый образ: бэкенд + собранный фронтенд в одном процессе.
#
#  Именно такой вариант нужен для бесплатных хостингов (Koyeb, Render и т.п.):
#  там даётся один инстанс, а не два. Бэкенд раздаёт статику сам
#  (SERVE_FRONTEND=true), поэтому отдельный nginx не требуется.
#
#  Сборка:  docker build -t stock2 .
#  Запуск:  docker run -p 8080:8080 --env-file .env stock2
# ============================================================================

# ------------------------------ Этап сборки --------------------------------
FROM node:20-alpine AS builder

WORKDIR /app

# Манифесты отдельно — слой с зависимостями кэшируется между сборками
COPY package.json package-lock.json ./
COPY backend/package.json ./backend/
COPY frontend/package.json ./frontend/

RUN npm ci

# Параметры бренда попадают в сборку фронтенда
ARG VITE_API_URL=""
ARG VITE_BRAND_NAME="STOCK2"
ARG VITE_BRAND_TAGLINE="UPGRADER STANDOFF 2"
ARG VITE_TELEGRAM_URL="https://t.me/stock2_shop"

ENV VITE_API_URL=$VITE_API_URL \
    VITE_BRAND_NAME=$VITE_BRAND_NAME \
    VITE_BRAND_TAGLINE=$VITE_BRAND_TAGLINE \
    VITE_TELEGRAM_URL=$VITE_TELEGRAM_URL

COPY backend ./backend
COPY frontend ./frontend
COPY migrations ./migrations
COPY public ./public
COPY database ./database

RUN npm run build --workspace backend && npm run build --workspace frontend

# ------------------------------ Этап запуска -------------------------------
FROM node:20-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production \
    SERVE_FRONTEND=true \
    FRONTEND_DIR=/app/frontend/dist \
    PORT=8080

RUN apk add --no-cache tini wget && addgroup -S app && adduser -S app -G app

COPY package.json package-lock.json ./
COPY backend/package.json ./backend/
COPY frontend/package.json ./frontend/

# Только production-зависимости бэкенда
RUN npm ci --workspace backend --include-workspace-root --omit=dev && npm cache clean --force

COPY --from=builder /app/backend/dist ./backend/dist
COPY --from=builder /app/frontend/dist ./frontend/dist
COPY migrations ./migrations
COPY public ./public
COPY database ./database

# Изображения предметов уже лежат в сборке фронтенда:
# Vite копирует туда содержимое public/ (см. publicDir в vite.config.ts)
RUN chown -R app:app /app

USER app
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 \
  CMD wget -qO- http://127.0.0.1:${PORT}/api/health || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "backend/dist/index.js"]
