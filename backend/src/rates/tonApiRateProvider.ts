/**
 * Курс TON → рубль с tonapi.io.
 * Ключ необязателен, но с ним выше лимиты (переменная TON_API_KEY).
 */
import { env } from '../config/env';
import { assertSaneRate, type RateProvider, type RateQuote } from './RateProvider';

const ENDPOINT = 'https://tonapi.io/v2/rates';

interface TonApiRatesResponse {
  rates?: {
    TON?: {
      prices?: Record<string, number>;
    };
  };
}

export class TonApiRateProvider implements RateProvider {
  public readonly name = 'tonapi';

  constructor(private readonly apiKey = env.ton.apiKey) {}

  public isConfigured(): boolean {
    return true;
  }

  public async fetchRate(signal?: AbortSignal): Promise<RateQuote> {
    const url = new URL(ENDPOINT);
    url.searchParams.set('tokens', 'ton');
    url.searchParams.set('currencies', 'rub');

    const headers: Record<string, string> = { Accept: 'application/json' };
    if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;

    const response = await fetch(url, { headers, signal: signal ?? AbortSignal.timeout(12_000) });
    if (!response.ok) throw new Error(`tonapi.io вернул статус ${response.status}`);

    const data = (await response.json()) as TonApiRatesResponse;
    const prices = data.rates?.TON?.prices ?? {};
    const rubPerTon = prices.RUB ?? prices.rub;
    if (rubPerTon === undefined) throw new Error('tonapi.io не вернул курс TON в рублях');

    return {
      rubPerTon: assertSaneRate(rubPerTon, this.name),
      source: this.name,
      fetchedAt: new Date(),
    };
  }
}
