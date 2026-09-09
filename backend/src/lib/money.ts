/**
 * Денежные величины.
 *
 * Внутренняя валюта площадки — «монеты»: 1 монета = 1 ₽.
 * Все суммы хранятся целыми числами КОПЕЕК (bigint):
 *     1 монета = 100 копеек.
 * Это полностью исключает ошибки округления чисел с плавающей точкой.
 *
 * Пополнение приходит в TON, поэтому отдельно поддерживаются нанотоны
 * (1 TON = 1_000_000_000 нанотон) — см. tonToNano/nanoToTon и currencyService.
 */

/** Копеек в одной монете. */
export const MINOR_IN_COIN = 100n;
/** Нанотон в одном TON. */
export const NANO_IN_TON = 1_000_000_000n;
export const TON_DECIMALS = 9;

/* -------------------------------------------------------------------------- */
/*                          Внутренняя валюта (монеты)                        */
/* -------------------------------------------------------------------------- */

/** Строка/число монет → копейки. Бросает ошибку на некорректном вводе. */
export function coinsToMinor(value: string | number): bigint {
  const raw = typeof value === 'number' ? value.toFixed(2) : value.trim().replace(',', '.');
  if (!/^-?\d+(\.\d{1,2})?$/.test(raw)) {
    throw new Error(`Некорректная сумма в монетах: ${value}`);
  }
  const negative = raw.startsWith('-');
  const unsigned = negative ? raw.slice(1) : raw;
  const [whole = '0', fraction = ''] = unsigned.split('.');
  const paddedFraction = (fraction + '00').slice(0, 2);
  const result = BigInt(whole) * MINOR_IN_COIN + BigInt(paddedFraction || '0');
  return negative ? -result : result;
}

/** Копейки → строка монет без потери точности («1234.50»). */
export function minorToCoins(value: bigint): string {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const whole = abs / MINOR_IN_COIN;
  const fraction = abs % MINOR_IN_COIN;
  const body = fraction === 0n ? whole.toString() : `${whole}.${fraction.toString().padStart(2, '0')}`;
  return negative ? `-${body}` : body;
}

/** Форматирование для интерфейса: «1 234.50». */
export function formatCoins(value: bigint, decimals = 2): string {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const whole = abs / MINOR_IN_COIN;
  const fraction = abs % MINOR_IN_COIN;
  const body =
    decimals > 0 ? `${whole}.${fraction.toString().padStart(2, '0').slice(0, decimals)}` : whole.toString();
  return negative ? `-${body}` : body;
}

/* -------------------------------------------------------------------------- */
/*                                    TON                                     */
/* -------------------------------------------------------------------------- */

/** Строка/число TON → нанотоны. */
export function tonToNano(value: string | number): bigint {
  const raw = typeof value === 'number' ? value.toFixed(TON_DECIMALS) : value.trim().replace(',', '.');
  if (!/^-?\d+(\.\d+)?$/.test(raw)) {
    throw new Error(`Некорректная сумма TON: ${value}`);
  }
  const negative = raw.startsWith('-');
  const unsigned = negative ? raw.slice(1) : raw;
  const [whole = '0', fraction = ''] = unsigned.split('.');
  const paddedFraction = (fraction + '0'.repeat(TON_DECIMALS)).slice(0, TON_DECIMALS);
  const result = BigInt(whole) * NANO_IN_TON + BigInt(paddedFraction || '0');
  return negative ? -result : result;
}

/** Нанотоны → строка TON без потери точности. */
export function nanoToTon(value: bigint): string {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const whole = abs / NANO_IN_TON;
  const fraction = abs % NANO_IN_TON;
  const fractionStr = fraction.toString().padStart(TON_DECIMALS, '0').replace(/0+$/, '');
  const body = fractionStr ? `${whole}.${fractionStr}` : whole.toString();
  return negative ? `-${body}` : body;
}

/** Форматирование TON для интерфейса (по умолчанию 2 знака). */
export function formatTon(value: bigint, decimals = 2): string {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const scale = 10n ** BigInt(TON_DECIMALS - decimals);
  const scaled = (abs + scale / 2n) / scale; // округление к ближайшему
  const whole = scaled / 10n ** BigInt(decimals);
  const fraction = scaled % 10n ** BigInt(decimals);
  const body = decimals > 0 ? `${whole}.${fraction.toString().padStart(decimals, '0')}` : whole.toString();
  return negative ? `-${body}` : body;
}

/* -------------------------------------------------------------------------- */
/*                                 Конвертация                                */
/* -------------------------------------------------------------------------- */

/**
 * Нанотоны → копейки по курсу «копеек за 1 TON».
 * Округление вниз: площадка никогда не зачисляет больше, чем получила.
 */
export function nanoToMinor(nano: bigint, minorPerTon: bigint): bigint {
  return (nano * minorPerTon) / NANO_IN_TON;
}

/** Копейки → нанотоны по курсу (округление вверх, чтобы не занизить счёт). */
export function minorToNano(minor: bigint, minorPerTon: bigint): bigint {
  if (minorPerTon <= 0n) throw new Error('Курс должен быть больше нуля');
  const product = minor * NANO_IN_TON;
  return (product + minorPerTon - 1n) / minorPerTon;
}

/* -------------------------------------------------------------------------- */
/*                              Общие помощники                               */
/* -------------------------------------------------------------------------- */

/** Безопасно приводит значение из БД (string | number | bigint) к bigint. */
export function toBigInt(value: unknown): bigint {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') return BigInt(Math.trunc(value));
  if (typeof value === 'string') return BigInt(value);
  if (value === null || value === undefined) return 0n;
  throw new Error(`Невозможно привести значение к bigint: ${String(value)}`);
}

/** Представление суммы в монетах для API. */
export interface MoneyDto {
  /** Сумма в копейках (целое число строкой). */
  minor: string;
  /** Сумма в монетах («1234.50»). */
  coins: string;
  /** Готовая строка для интерфейса. */
  formatted: string;
  currency: 'COIN';
}

export function money(value: bigint): MoneyDto {
  return {
    minor: value.toString(),
    coins: minorToCoins(value),
    formatted: formatCoins(value, 2),
    currency: 'COIN',
  };
}

/** Представление суммы в TON для API (используется только в пополнениях). */
export interface TonMoneyDto {
  nano: string;
  ton: string;
  formatted: string;
  currency: 'TON';
}

export function tonMoney(value: bigint): TonMoneyDto {
  return {
    nano: value.toString(),
    ton: nanoToTon(value),
    formatted: formatTon(value, 2),
    currency: 'TON',
  };
}
