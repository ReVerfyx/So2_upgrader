/**
 * Тесты курсовых источников.
 * Сетевые ответы подменяются фикстурами реального формата.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CoinGeckoRateProvider } from '../src/rates/coinGeckoProvider';
import { TonApiRateProvider } from '../src/rates/tonApiRateProvider';
import { BinanceCbrRateProvider } from '../src/rates/binanceCbrProvider';
import { assertSaneRate } from '../src/rates/RateProvider';
import { applySpread, rubPerTonToMinor } from '../src/services/rateService';
import { nanoToMinor, tonToNano } from '../src/lib/money';

function mockJson(payload: unknown, ok = true, status = 200): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok, status, json: async () => payload })) as unknown as typeof fetch,
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('CoinGecko', () => {
  it('читает курс TON в рублях', async () => {
    mockJson({ 'the-open-network': { rub: 352.47 } });
    const quote = await new CoinGeckoRateProvider('').fetchRate();
    expect(quote.rubPerTon).toBeCloseTo(352.47, 2);
    expect(quote.source).toBe('coingecko');
  });

  it('падает, если курса нет в ответе', async () => {
    mockJson({});
    await expect(new CoinGeckoRateProvider('').fetchRate()).rejects.toThrow(/не вернул курс/);
  });

  it('падает на ошибке HTTP', async () => {
    mockJson({}, false, 429);
    await expect(new CoinGeckoRateProvider('').fetchRate()).rejects.toThrow(/429/);
  });
});

describe('tonapi.io', () => {
  it('читает курс из структуры rates.TON.prices', async () => {
    mockJson({ rates: { TON: { prices: { RUB: 349.9 } } } });
    const quote = await new TonApiRateProvider('').fetchRate();
    expect(quote.rubPerTon).toBeCloseTo(349.9, 2);
  });
});

describe('Binance + ЦБ РФ', () => {
  it('перемножает TONUSDT и курс доллара', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: URL | string) => {
        const href = String(url);
        if (href.includes('binance')) return { ok: true, status: 200, json: async () => ({ price: '3.92' }) };
        return { ok: true, status: 200, json: async () => ({ Valute: { USD: { Value: 89.5 } } }) };
      }) as unknown as typeof fetch,
    );

    const quote = await new BinanceCbrRateProvider().fetchRate();
    expect(quote.rubPerTon).toBeCloseTo(3.92 * 89.5, 4);
  });
});

describe('Проверка правдоподобности курса', () => {
  it('пропускает разумные значения', () => {
    expect(assertSaneRate(350, 'test')).toBe(350);
  });

  it('отклоняет ноль, отрицательные и абсурдные значения', () => {
    expect(() => assertSaneRate(0, 'test')).toThrow();
    expect(() => assertSaneRate(-5, 'test')).toThrow();
    expect(() => assertSaneRate(0.2, 'test')).toThrow(/диапазона/);
    expect(() => assertSaneRate(500_000, 'test')).toThrow(/диапазона/);
    expect(() => assertSaneRate(Number.NaN, 'test')).toThrow();
  });
});

describe('Спред и перевод курса', () => {
  it('уменьшает курс на величину спреда', () => {
    expect(applySpread(400, 0)).toBe(400);
    expect(applySpread(400, 3)).toBeCloseTo(388, 6);
    expect(applySpread(400, 100)).toBeCloseTo(200, 6); // спред ограничен 50%
  });

  it('переводит рубли за TON в копейки за TON', () => {
    expect(rubPerTonToMinor(350)).toBe(35_000n);
    expect(rubPerTonToMinor(352.475)).toBe(35_248n);
  });

  it('пополнение пересчитывается в монеты по курсу', () => {
    const minorPerTon = rubPerTonToMinor(applySpread(360, 3)); // 349.2 ₽ за TON
    const credited = nanoToMinor(tonToNano('0.88'), minorPerTon);
    // 0.88 TON × 349.2 ₽ = 307.29 ₽ → 30729 копеек (округление вниз)
    expect(credited).toBe(30_729n);
  });
});
