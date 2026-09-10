/**
 * Загрузка и валидация переменных окружения.
 * Ни один секрет не имеет значения по умолчанию в production —
 * приложение падает на старте, если обязательная переменная не задана.
 */
import path from 'node:path';
import fs from 'node:fs';
import dotenv from 'dotenv';

// .env ищем в корне репозитория и в папке backend
const candidates = [
  path.resolve(process.cwd(), '.env'),
  path.resolve(process.cwd(), '..', '.env'),
  path.resolve(__dirname, '..', '..', '..', '.env'),
];
for (const file of candidates) {
  if (fs.existsSync(file)) {
    dotenv.config({ path: file });
    break;
  }
}

function str(name: string, fallback?: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    if (fallback !== undefined) return fallback;
    throw new Error(`Не задана обязательная переменная окружения ${name}`);
  }
  return value;
}

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Переменная окружения ${name} должна быть числом, получено: ${raw}`);
  }
  return parsed;
}

function bool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw.toLowerCase());
}

const nodeEnv = str('NODE_ENV', 'development');
const isProduction = nodeEnv === 'production';
const isTest = nodeEnv === 'test';

// Тестовый режим (dev-эндпоинты) физически невозможно включить в production.
const testModeRequested = bool('TEST_MODE', !isProduction);
const testMode = isProduction ? false : testModeRequested;

if (isProduction && testModeRequested) {
  console.warn('[env] TEST_MODE=true игнорируется, так как NODE_ENV=production');
}

const appUrl = str('APP_URL', 'http://localhost:5173');
const corsOrigins = str('CORS_ORIGINS', '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

export const env = {
  nodeEnv,
  isProduction,
  isTest,
  isDevelopment: !isProduction && !isTest,
  testMode,
  port: num('PORT', 4000),
  appUrl,
  corsOrigins: corsOrigins.length > 0 ? corsOrigins : [appUrl],
  trustProxy: bool('TRUST_PROXY', false),

  database: {
    url: str('DATABASE_URL', isProduction ? undefined : 'postgres://postgres@127.0.0.1:5432/upgrader'),
    ssl: bool('DATABASE_SSL', false),
    poolMax: num('DATABASE_POOL_MAX', 10),
  },

  security: {
    sessionSecret: str('SESSION_SECRET', isProduction ? undefined : 'dev-session-secret-change-me'),
    adminSecret: str('ADMIN_SECRET', isProduction ? undefined : 'dev-admin-secret-change-me'),
    sessionTtlHours: num('SESSION_TTL_HOURS', 24 * 7),
    cookieName: str('SESSION_COOKIE_NAME', 'so2_session'),
    csrfCookieName: str('CSRF_COOKIE_NAME', 'so2_csrf'),
    bcryptRounds: num('BCRYPT_ROUNDS', isTest ? 4 : 12),
    /**
     * Флаг Secure у cookie сессии. По умолчанию включён в production.
     * Отключайте только если сайт доступен по http (например, локальный
     * запуск или внутренний контур) — иначе браузер не сохранит сессию.
     */
    cookieSecure: bool('COOKIE_SECURE', isProduction),
  },

  /** Раздача собранного фронтенда тем же процессом (деплой без nginx). */
  frontend: {
    serve: bool('SERVE_FRONTEND', false),
    dir: str('FRONTEND_DIR', ''),
  },

  google: {
    clientId: str('GOOGLE_CLIENT_ID', ''),
    clientSecret: str('GOOGLE_CLIENT_SECRET', ''),
    redirectUri: str('GOOGLE_REDIRECT_URI', ''),
    successRedirect: str('GOOGLE_SUCCESS_REDIRECT', ''),
  },

  ton: {
    walletAddress: str('TON_WALLET_ADDRESS', ''),
    provider: str('TON_PROVIDER', 'mock') as 'toncenter' | 'tonapi' | 'mock',
    apiKey: str('TON_API_KEY', ''),
    apiBaseUrl: str('TON_API_BASE_URL', 'https://toncenter.com/api/v2'),
    minConfirmations: num('TON_MIN_CONFIRMATIONS', 1),
    pollIntervalMs: num('TON_POLL_INTERVAL_MS', 20_000),
    /**
     * Интервал опроса, когда неоплаченных счетов нет.
     * Длинная пауза позволяет serverless-базе заснуть и не расходовать
     * бесплатные часы работы.
     */
    idlePollIntervalMs: num('TON_IDLE_POLL_INTERVAL_MS', 10 * 60_000),
    watcherEnabled: bool('TON_WATCHER_ENABLED', !isTest),
  },

  rates: {
    /** Источники курса в порядке приоритета. */
    providers: str('RATE_PROVIDERS', 'coingecko,tonapi,binance+cbr'),
    /** Как часто обновлять курс, минут. */
    refreshMinutes: num('RATE_REFRESH_MINUTES', 15),
    /** Максимальный возраст курса, после которого пополнение блокируется (0 — не проверять). */
    maxAgeMinutes: num('RATE_MAX_AGE_MINUTES', 180),
    /** Спред площадки к рыночному курсу, %. */
    spreadPercent: num('RATE_SPREAD_PERCENT', 3),
    /** Обновлять ли курс автоматически. */
    auto: bool('RATE_AUTO_UPDATE', true),
  },

  economy: {
    /** Сколько копеек даётся за 1 TON (1 монета = 1 рубль = 100 копеек). */
    minorPerTon: num('COIN_MINOR_PER_TON', 35_000),
    minDepositTon: num('MIN_DEPOSIT_TON', 0.88),
    depositTtlMinutes: num('DEPOSIT_TTL_MINUTES', 30),
    upgradeHouseEdge: num('UPGRADE_HOUSE_EDGE', 0.08),
    upgradeMinChance: num('UPGRADE_MIN_CHANCE', 0.005),
    upgradeMaxChance: num('UPGRADE_MAX_CHANCE', 0.85),
    upgradeMaxMultiplier: num('UPGRADE_MAX_MULTIPLIER', 100),
    upgradeMinStakeCoins: num('UPGRADE_MIN_STAKE_COINS', 10),
  },
} as const;

/** Проверка конфигурации, критичной для production. */
export function assertProductionConfig(): void {
  if (!env.isProduction) return;
  const problems: string[] = [];
  if (env.security.sessionSecret.length < 32) problems.push('SESSION_SECRET должен быть длиной не менее 32 символов');
  if (env.security.adminSecret.length < 16) problems.push('ADMIN_SECRET должен быть длиной не менее 16 символов');
  if (!env.ton.walletAddress) problems.push('TON_WALLET_ADDRESS обязателен в production');
  if (env.ton.provider === 'mock') problems.push('TON_PROVIDER=mock недопустим в production');
  if (problems.length > 0) {
    throw new Error(`Некорректная конфигурация production:\n - ${problems.join('\n - ')}`);
  }
}
