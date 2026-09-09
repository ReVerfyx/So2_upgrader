/**
 * Курс TON → рубль с CoinGecko.
 * Публичный API работает без ключа; при наличии ключа Pro-плана он
 * подставляется в заголовок (переменная COINGECKO_API_KEY).
 */
import { assertSaneRate, type RateProvider, type RateQuote } from './RateProvider';

const ENDPOINT = 'https://api.coingecko.com/api/v3/simple/price';

interface CoinGeckoResponse {
  'the-open-network'?: { rub?: number };
}

export class CoinGeckoRateProvider implements RateProvider {
  public readonly name = 'coingecko';

  constructor(private readonly apiKey = process.env.COINGECKO_API_KEY ?? '') {}

  public isConfigured(): boolean {
    return true; // публичный доступ не требует ключа
  }

  public async fetchRate(signal?: AbortSignal): Promise<RateQuote> {
    const url = new URL(ENDPOINT);
    url.searchParams.set('ids', 'the-open-network');
    url.searchParams.set('vs_currencies', 'rub');

    const headers: Record<string, string> = { Accept: 'application/json' };
    if (this.apiKey) headers['x-cg-pro-api-key'] = this.apiKey;

    const response = await fetch(url, { headers, signal: signal ?? AbortSignal.timeout(12_000) });
    if (!response.ok) throw new Error(`CoinGecko вернул статус ${response.status}`);

    const data = (await response.json()) as CoinGeckoResponse;
    const rubPerTon = data['the-open-network']?.rub;
    if (rubPerTon === undefined) throw new Error('CoinGecko не вернул курс TON в рублях');

    return {
      rubPerTon: assertSaneRate(rubPerTon, this.name),
      source: this.name,
      fetchedAt: new Date(),
    };
  }
}
