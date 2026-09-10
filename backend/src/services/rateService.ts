/**
 * Курс TON → монеты.
 *
 * Как работает:
 *  1. Источники опрашиваются по очереди (CoinGecko → tonapi.io → Binance+ЦБ РФ).
 *     Первый успешный ответ побеждает; ошибки остальных попадают в журнал.
 *  2. К рыночному курсу применяется спред площадки (`spreadPercent`):
 *     он покрывает комиссии сети и колебания между оплатой и зачислением.
 *  3. Результат сохраняется в app_settings.rates — это и кэш, и то значение,
 *     по которому фиксируются счета на пополнение.
 *  4. Если все источники недоступны, продолжает действовать последний
 *     известный курс. Когда он устаревает сверх `RATE_MAX_AGE_MINUTES`,
 *     создание новых счетов блокируется — лучше отказать, чем зачислить
 *     деньги по неверному курсу.
 *
 * Ручной режим (`auto = false`) полностью отключает обращения к источникам:
 * действует только курс, заданный администратором.
 */
import { env } from '../config/env';
import { logger } from '../lib/logger';
import { AppError } from '../lib/errors';
import { getRateSettings, updateSetting, type RateSettings } from './settingsService';
import type { RateProvider, RateQuote } from '../rates/RateProvider';
import { CoinGeckoRateProvider } from '../rates/coinGeckoProvider';
import { TonApiRateProvider } from '../rates/tonApiRateProvider';
import { BinanceCbrRateProvider } from '../rates/binanceCbrProvider';

let providers: RateProvider[] | null = null;

/** Список источников в порядке приоритета (задаётся RATE_PROVIDERS). */
export function getRateProviders(): RateProvider[] {
  if (providers) return providers;

  const registry: Record<string, () => RateProvider> = {
    coingecko: () => new CoinGeckoRateProvider(),
    tonapi: () => new TonApiRateProvider(),
    'binance+cbr': () => new BinanceCbrRateProvider(),
  };

  const requested = env.rates.providers
    .split(',')
    .map((name) => name.trim().toLowerCase())
    .filter(Boolean);

  const list = requested
    .map((name) => registry[name])
    .filter((factory): factory is () => RateProvider => Boolean(factory))
    .map((factory) => factory());

  providers = list.length > 0 ? list : [new CoinGeckoRateProvider(), new TonApiRateProvider(), new BinanceCbrRateProvider()];
  return providers;
}

/** Подмена источников (используется в тестах). */
export function setRateProviders(list: RateProvider[] | null): void {
  providers = list;
}

export interface RateUpdateResult {
  updated: boolean;
  rubPerTon: number;
  minorPerTon: bigint;
  source: string;
  /** Ошибки источников, которые не ответили. */
  failures: Array<{ provider: string; message: string }>;
}

/** Применяет спред площадки: курс зачисления чуть ниже рыночного. */
export function applySpread(rubPerTon: number, spreadPercent: number): number {
  const safeSpread = Math.min(Math.max(spreadPercent, 0), 50);
  return rubPerTon * (1 - safeSpread / 100);
}

/** Рубли за TON → копейки за TON (внутреннее представление курса). */
export function rubPerTonToMinor(rubPerTon: number): bigint {
  return BigInt(Math.round(rubPerTon * 100));
}

/**
 * Опрашивает источники и сохраняет свежий курс.
 * @param force обновить даже в ручном режиме
 */
export async function refreshRate(options: { force?: boolean; adminId?: string } = {}): Promise<RateUpdateResult> {
  const settings = await getRateSettings();

  if (!settings.auto && !options.force) {
    return {
      updated: false,
      rubPerTon: Number(settings.minorPerTon) / 100,
      minorPerTon: settings.minorPerTon,
      source: settings.source,
      failures: [],
    };
  }

  const failures: Array<{ provider: string; message: string }> = [];
  let quote: RateQuote | null = null;

  for (const provider of getRateProviders()) {
    if (!provider.isConfigured()) {
      failures.push({ provider: provider.name, message: 'источник не настроен' });
      continue;
    }
    try {
      quote = await provider.fetchRate();
      break;
    } catch (error) {
      failures.push({ provider: provider.name, message: (error as Error).message });
    }
  }

  if (!quote) {
    logger.warn('Не удалось обновить курс TON', { failures });
    return {
      updated: false,
      rubPerTon: Number(settings.minorPerTon) / 100,
      minorPerTon: settings.minorPerTon,
      source: settings.source,
      failures,
    };
  }

  const effectiveRub = applySpread(quote.rubPerTon, settings.spreadPercent);
  const minorPerTon = rubPerTonToMinor(effectiveRub);

  await updateSetting(
    'rates',
    {
      minorPerTon: minorPerTon.toString(),
      marketRubPerTon: quote.rubPerTon,
      spreadPercent: settings.spreadPercent,
      auto: settings.auto,
      maxAgeMinutes: settings.maxAgeMinutes,
      source: quote.source,
      updatedAt: quote.fetchedAt.toISOString(),
    },
    options.adminId ?? null,
  );

  logger.info('Курс TON обновлён', {
    источник: quote.source,
    рыночный: quote.rubPerTon,
    спред: settings.spreadPercent,
    курсЗачисления: effectiveRub,
  });

  return { updated: true, rubPerTon: effectiveRub, minorPerTon, source: quote.source, failures };
}

/**
 * Актуальный курс для операций пополнения.
 * Бросает ошибку, если курс устарел, — счёт не будет выставлен по неверной цене.
 */
export async function getUsableRate(): Promise<RateSettings> {
  const settings = await getRateSettings();

  if (settings.auto && settings.maxAgeMinutes > 0) {
    const updatedAt = settings.updatedAt ? new Date(settings.updatedAt).getTime() : 0;
    const ageMinutes = updatedAt > 0 ? (Date.now() - updatedAt) / 60_000 : Number.POSITIVE_INFINITY;

    if (ageMinutes > settings.maxAgeMinutes) {
      // Пробуем обновить прямо сейчас: возможно, источник уже доступен.
      const refreshed = await refreshRate();
      if (refreshed.updated) return getRateSettings();

      throw new AppError(
        'Курс TON временно недоступен, пополнение приостановлено. Попробуйте через несколько минут.',
        { status: 503, code: 'RATE_UNAVAILABLE' },
      );
    }
  }

  return settings;
}

/** Информация о курсе для интерфейса. */
export async function getRateInfo(): Promise<{
  coinsPerTon: string;
  marketRubPerTon: number | null;
  spreadPercent: number;
  auto: boolean;
  maxAgeMinutes: number;
  source: string;
  updatedAt: string | null;
  ageMinutes: number | null;
  stale: boolean;
}> {
  const settings = await getRateSettings();
  const updatedAt = settings.updatedAt ? new Date(settings.updatedAt).getTime() : 0;
  const ageMinutes = updatedAt > 0 ? Math.floor((Date.now() - updatedAt) / 60_000) : null;

  return {
    coinsPerTon: (Number(settings.minorPerTon) / 100).toFixed(2),
    marketRubPerTon: settings.marketRubPerTon,
    spreadPercent: settings.spreadPercent,
    auto: settings.auto,
    maxAgeMinutes: settings.maxAgeMinutes,
    source: settings.source,
    updatedAt: settings.updatedAt,
    ageMinutes,
    stale:
      settings.auto &&
      settings.maxAgeMinutes > 0 &&
      (ageMinutes === null || ageMinutes > settings.maxAgeMinutes),
  };
}
