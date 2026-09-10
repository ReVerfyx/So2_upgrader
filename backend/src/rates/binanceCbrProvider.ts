/**
 * Курс TON → рубль через связку Binance + ЦБ РФ.
 *
 *   TON/RUB = (цена TON в USDT на Binance) × (официальный курс USD ЦБ РФ)
 *
 * Полезен как резервный источник: работает, даже когда криптоагрегаторы
 * недоступны, и опирается на официальный рублёвый курс.
 */
import { assertSaneRate, type RateProvider, type RateQuote } from './RateProvider';

const BINANCE_ENDPOINT = 'https://api.binance.com/api/v3/ticker/price';
const CBR_ENDPOINT = 'https://www.cbr-xml-daily.ru/daily_json.js';

interface BinancePriceResponse {
  symbol?: string;
  price?: string;
}

interface CbrResponse {
  Valute?: { USD?: { Value?: number } };
}

export class BinanceCbrRateProvider implements RateProvider {
  public readonly name = 'binance+cbr';

  public isConfigured(): boolean {
    return true;
  }

  public async fetchRate(signal?: AbortSignal): Promise<RateQuote> {
    const timeout = signal ?? AbortSignal.timeout(12_000);

    const [tonUsdt, usdRub] = await Promise.all([this.fetchTonUsdt(timeout), this.fetchUsdRub(timeout)]);
    const rubPerTon = tonUsdt * usdRub;

    return {
      rubPerTon: assertSaneRate(rubPerTon, this.name),
      source: this.name,
      fetchedAt: new Date(),
    };
  }

  private async fetchTonUsdt(signal: AbortSignal): Promise<number> {
    const url = new URL(BINANCE_ENDPOINT);
    url.searchParams.set('symbol', 'TONUSDT');

    const response = await fetch(url, { headers: { Accept: 'application/json' }, signal });
    if (!response.ok) throw new Error(`Binance вернул статус ${response.status}`);

    const data = (await response.json()) as BinancePriceResponse;
    const price = Number(data.price);
    if (!Number.isFinite(price) || price <= 0) throw new Error('Binance не вернул цену TONUSDT');
    return price;
  }

  private async fetchUsdRub(signal: AbortSignal): Promise<number> {
    const response = await fetch(CBR_ENDPOINT, { headers: { Accept: 'application/json' }, signal });
    if (!response.ok) throw new Error(`ЦБ РФ вернул статус ${response.status}`);

    const data = (await response.json()) as CbrResponse;
    const value = data.Valute?.USD?.Value;
    if (!Number.isFinite(value) || !value || value <= 0) throw new Error('ЦБ РФ не вернул курс доллара');
    return value;
  }
}
