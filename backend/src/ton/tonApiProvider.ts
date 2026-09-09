/**
 * Провайдер блокчейна TON на базе tonapi.io.
 *
 * Альтернатива toncenter: другой оператор, другой формат ответа.
 * Выбирается переменной TON_PROVIDER=tonapi. Ключ (TON_API_KEY)
 * необязателен, но повышает лимиты запросов.
 */
import { env } from '../config/env';
import type { FetchTransactionsParams, TonIncomingTransaction, TonProvider } from './TonProvider';

interface TonApiMessage {
  hash?: string;
  source?: { address?: string } | null;
  destination?: { address?: string } | null;
  value?: number | string;
  decoded_op_name?: string | null;
  decoded_body?: { text?: string } | null;
  bounced?: boolean;
}

interface TonApiTransaction {
  hash: string;
  lt: number | string;
  utime: number;
  success?: boolean;
  aborted?: boolean;
  block?: string;
  in_msg?: TonApiMessage | null;
}

interface TonApiResponse {
  transactions?: TonApiTransaction[];
  error?: string;
}

export class TonApiProvider implements TonProvider {
  public readonly name = 'tonapi';

  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(baseUrl = 'https://tonapi.io', apiKey = env.ton.apiKey) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.apiKey = apiKey;
  }

  public isConfigured(): boolean {
    return Boolean(env.ton.walletAddress);
  }

  public async getIncomingTransactions(params: FetchTransactionsParams): Promise<TonIncomingTransaction[]> {
    const url = new URL(`${this.baseUrl}/v2/blockchain/accounts/${params.address}/transactions`);
    url.searchParams.set('limit', String(Math.min(params.limit, 1000)));
    if (params.sinceUtime) url.searchParams.set('after_lt', '0');

    const headers: Record<string, string> = { Accept: 'application/json' };
    if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;

    const response = await fetch(url, { headers, signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error(`tonapi.io вернул статус ${response.status}`);

    const data = (await response.json()) as TonApiResponse;
    if (data.error) throw new Error(`tonapi.io: ${data.error}`);

    return (data.transactions ?? [])
      .filter((tx) => {
        const msg = tx.in_msg;
        if (!msg || !msg.value || String(msg.value) === '0') return false;
        if (msg.bounced === true) return false;
        if (tx.aborted === true) return false;
        if (tx.success === false) return false;
        return params.sinceUtime ? tx.utime >= params.sinceUtime : true;
      })
      .map((tx) => ({
        hash: tx.hash,
        lt: String(tx.lt),
        amountNano: BigInt(String(tx.in_msg?.value ?? '0')),
        comment: tx.in_msg?.decoded_body?.text?.trim() || null,
        sender: tx.in_msg?.source?.address ?? null,
        destination: tx.in_msg?.destination?.address ?? params.address,
        utime: tx.utime,
        blockSeqno: parseBlockSeqno(tx.block),
      }));
  }

  public async getConfirmations(tx: TonIncomingTransaction): Promise<number> {
    // tonapi отдаёт только подтверждённые (финализированные) транзакции,
    // поэтому дополнительно учитываем выдержку по времени.
    const ageSeconds = Math.floor(Date.now() / 1000) - tx.utime;
    return ageSeconds >= 0 ? Math.max(1, Math.floor(ageSeconds / 5) + 1) : 0;
  }
}

/** Номер блока из строки вида "(-1,8000000000000000,48123456)". */
export function parseBlockSeqno(block?: string): number | null {
  if (!block) return null;
  const match = /,(\d+)\)?$/.exec(block.trim());
  return match?.[1] ? Number(match[1]) : null;
}
