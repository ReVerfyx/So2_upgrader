/**
 * Провайдер на базе публичного API toncenter.com (v2).
 * Совместим с self-hosted версией — базовый URL настраивается через окружение.
 */
import { env } from '../config/env';
import { logger } from '../lib/logger';
import type { FetchTransactionsParams, TonIncomingTransaction, TonProvider } from './TonProvider';

interface TonCenterMessage {
  source?: string;
  destination?: string;
  value?: string;
  message?: string;
  msg_data?: { text?: string; body?: string };
}

interface TonCenterTransaction {
  transaction_id: { hash: string; lt: string };
  utime: number;
  in_msg?: TonCenterMessage;
}

interface TonCenterResponse {
  ok: boolean;
  result?: TonCenterTransaction[];
  error?: string;
}

export class TonCenterProvider implements TonProvider {
  public readonly name = 'toncenter';

  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(baseUrl = env.ton.apiBaseUrl, apiKey = env.ton.apiKey) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.apiKey = apiKey;
  }

  public isConfigured(): boolean {
    return Boolean(env.ton.walletAddress);
  }

  public async getIncomingTransactions(params: FetchTransactionsParams): Promise<TonIncomingTransaction[]> {
    const url = new URL(`${this.baseUrl}/getTransactions`);
    url.searchParams.set('address', params.address);
    url.searchParams.set('limit', String(params.limit));
    url.searchParams.set('archival', 'true');

    const headers: Record<string, string> = { Accept: 'application/json' };
    if (this.apiKey) headers['X-API-Key'] = this.apiKey;

    const response = await fetch(url, { headers, signal: AbortSignal.timeout(15_000) });
    if (!response.ok) {
      throw new Error(`toncenter вернул статус ${response.status}`);
    }

    const data = (await response.json()) as TonCenterResponse;
    if (!data.ok || !data.result) {
      throw new Error(`toncenter вернул ошибку: ${data.error ?? 'неизвестная ошибка'}`);
    }

    return data.result
      .filter((tx) => tx.in_msg && tx.in_msg.value && tx.in_msg.value !== '0')
      .filter((tx) => (params.sinceUtime ? tx.utime >= params.sinceUtime : true))
      .map((tx) => ({
        hash: tx.transaction_id.hash,
        lt: tx.transaction_id.lt,
        amountNano: BigInt(tx.in_msg?.value ?? '0'),
        comment: this.extractComment(tx.in_msg),
        sender: tx.in_msg?.source ?? null,
        destination: tx.in_msg?.destination ?? params.address,
        utime: tx.utime,
      }));
  }

  public async getConfirmations(tx: TonIncomingTransaction): Promise<number> {
    // В TON транзакция считается финальной сразу после включения в мастерчейн.
    // Для дополнительной защиты требуем «выдержку» по времени.
    const ageSeconds = Math.floor(Date.now() / 1000) - tx.utime;
    if (ageSeconds < 0) return 0;
    return ageSeconds >= 5 ? Math.max(1, Math.floor(ageSeconds / 5)) : 0;
  }

  private extractComment(msg?: TonCenterMessage): string | null {
    if (!msg) return null;
    if (msg.message) return msg.message;
    if (msg.msg_data?.text) {
      try {
        return Buffer.from(msg.msg_data.text, 'base64').toString('utf8');
      } catch (error) {
        logger.warn('Не удалось разобрать комментарий транзакции', { error: (error as Error).message });
        return null;
      }
    }
    return null;
  }
}
