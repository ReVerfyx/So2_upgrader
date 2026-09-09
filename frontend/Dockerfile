# ============================================================================
#  Образ фронтенда STOCK2: сборка Vite → раздача статики через nginx
# ============================================================================
FROM node:20-alpine AS builder

WORKDIR /app

ARG VITE_API_URL=""
ARG VITE_BRAND_NAME="STOCK2"
ARG VITE_BRAND_TAGLINE="UPGRADER STANDOFF 2"
ARG VITE_TELEGRAM_URL="https://t.me/stock2_shop"

ENV VITE_API_URL=$VITE_API_URL \
    VITE_BRAND_NAME=$VITE_BRAND_NAME \
    VITE_BRAND_TAGLINE=$VITE_BRAND_TAGLINE \
    VITE_TELEGRAM_URL=$VITE_TELEGRAM_URL

COPY package.json package-lock.json ./
COPY frontend/package.json ./frontend/
COPY backend/package.json ./backend/

RUN npm ci --workspace frontend --include-workspace-root

COPY frontend ./frontend
COPY public ./public

RUN npm run build --workspace frontend

# ---------------------------------------------------------------------------
FROM nginx:1.27-alpine AS runner

COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/frontend/dist /usr/share/nginx/html

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
