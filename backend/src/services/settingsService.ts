/**
 * Настройки площадки (таблица app_settings) с кэшем в памяти.
 * Значения по умолчанию берутся из переменных окружения,
 * администратор может менять их через админ-панель без перезапуска.
 */
import { queryOne, query, type Db } from '../db/tx';
import { pool } from '../db/pool';
import { env } from '../config/env';
import { tonToNano } from '../lib/money';
import type { UpgradeSettings } from '../lib/upgradeMath';

/** Настройки апгрейда вместе с минимальной ставкой балансом. */
export interface UpgradeSettingsFull extends UpgradeSettings {
  /** Минимальная ставка балансом, копейки. */
  minStakeMinor: bigint;
}

/** Курс обмена TON → монеты. */
export interface RateSettings {
  /** Сколько копеек за 1 TON (35000 = 350 монет). */
  minorPerTon: bigint;
  source: string;
  updatedAt: string | null;
}

export interface DepositSettings {
  /** Минимальная сумма пополнения в нанотонах. */
  minDepositNano: bigint;
  ttlMinutes: number;
  minConfirmations: number;
}

export interface SiteSettings {
  maintenance: boolean;
  announcement: string;
}

const CACHE_TTL_MS = 5_000;
const cache = new Map<string, { value: unknown; expiresAt: number }>();

async function readSetting<T>(key: string, fallback: T, db: Db = pool): Promise<T> {
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value as T;

  const row = await queryOne<{ value: unknown }>('SELECT value FROM app_settings WHERE key = $1', [key], db);
  const value = (row?.value as T) ?? fallback;
  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  return value;
}

export function invalidateSettingsCache(): void {
  cache.clear();
}

export async function getUpgradeSettings(db: Db = pool): Promise<UpgradeSettingsFull> {
  const fallback = {
    houseEdge: env.economy.upgradeHouseEdge,
    minChance: env.economy.upgradeMinChance,
    maxChance: env.economy.upgradeMaxChance,
    maxMultiplier: env.economy.upgradeMaxMultiplier,
    minStakeMinor: '1000',
  };
  const stored = await readSetting<Partial<Record<keyof typeof fallback, number | string>>>('upgrade', fallback, db);
  return {
    houseEdge: Number(stored.houseEdge ?? fallback.houseEdge),
    minChance: Number(stored.minChance ?? fallback.minChance),
    maxChance: Number(stored.maxChance ?? fallback.maxChance),
    maxMultiplier: Number(stored.maxMultiplier ?? fallback.maxMultiplier),
    minStakeMinor: BigInt(stored.minStakeMinor ?? fallback.minStakeMinor),
  };
}

export async function getDepositSettings(db: Db = pool): Promise<DepositSettings> {
  const fallback = {
    minDepositNano: tonToNano(env.economy.minDepositTon).toString(),
    ttlMinutes: env.economy.depositTtlMinutes,
    minConfirmations: env.ton.minConfirmations,
  };
  const stored = await readSetting<{ minDepositNano?: string | number; ttlMinutes?: number; minConfirmations?: number }>(
    'deposit',
    fallback,
    db,
  );
  return {
    minDepositNano: BigInt(stored.minDepositNano ?? fallback.minDepositNano),
    ttlMinutes: stored.ttlMinutes ?? fallback.ttlMinutes,
    minConfirmations: stored.minConfirmations ?? fallback.minConfirmations,
  };
}

export async function getSiteSettings(db: Db = pool): Promise<SiteSettings> {
  return readSetting<SiteSettings>('site', { maintenance: false, announcement: '' }, db);
}

export async function updateSetting(key: string, value: unknown, adminId: string, db: Db = pool): Promise<void> {
  await query(
    `INSERT INTO app_settings (key, value, updated_by)
     VALUES ($1, $2::jsonb, $3)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [key, JSON.stringify(value), adminId],
    db,
  );
  invalidateSettingsCache();
}

export async function getAllSettings(db: Db = pool): Promise<Record<string, unknown>> {
  const rows = await query<{ key: string; value: unknown }>('SELECT key, value FROM app_settings ORDER BY key', [], db);
  return Object.fromEntries(rows.map((row) => [row.key, row.value]));
}


/** Курс обмена TON → монеты (по умолчанию берётся из переменных окружения). */
export async function getRateSettings(db: Db = pool): Promise<RateSettings> {
  const fallback = { minorPerTon: String(env.economy.minorPerTon), source: 'env', updatedAt: null };
  const stored = await readSetting<{ minorPerTon?: string | number; source?: string; updatedAt?: string | null }>(
    'rates',
    fallback,
    db,
  );
  return {
    minorPerTon: BigInt(stored.minorPerTon ?? fallback.minorPerTon),
    source: stored.source ?? 'manual',
    updatedAt: stored.updatedAt ?? null,
  };
}
