/**
 * Провайдер блокчейна TON на базе toncenter.com.
 *
 * Используется API v3 (`/api/v3/transactions`), которое отдаёт разобранные
 * входящие сообщения вместе с текстовым комментарием — именно по нему
 * платёж связывается со счётом. При недоступности v3 выполняется откат
 * на v2 (`/api/v2/getTransactions`).
 *
 * Провайдер только ЧИТАЕТ блокчейн: приватный ключ кошелька серверу не нужен
 * и никогда не запрашивается.
 */
import { env } from '../config/env';
import { logger } from '../lib/logger';
import type { FetchTransactionsParams, TonIncomingTransaction, TonProvider } from './TonProvider';

/* ------------------------------- API v3 ---------------------------------- */

interface TonCenterV3Message {
  hash?: string;
  source?: string | null;
  destination?: string | null;
  value?: string | null;
  message_content?: { body?: string; decoded?: { type?: string; comment?: string } | null } | null;
  bounced?: boolean;
  bounce?: boolean;
}

interface TonCenterV3Transaction {
  hash: string;
  lt: string;
  now: number;
  mc_block_seqno?: number | null;
  in_msg?: TonCenterV3Message | null;
  description?: { aborted?: boolean; compute_ph?: { success?: boolean } } | null;
}

interface TonCenterV3Response {
  transactions?: TonCenterV3Transaction[];
  error?: string;
}

/* ------------------------------- API v2 ---------------------------------- */

interface TonCenterV2Message {
  source?: string;
  destination?: string;
  value?: string;
  message?: string;
  msg_data?: { '@type'?: string; text?: string; body?: string };
}

interface TonCenterV2Transaction {
  transaction_id: { hash: string; lt: string };
  utime: number;
  in_msg?: TonCenterV2Message;
}

interface TonCenterV2Response {
  ok: boolean;
  result?: TonCenterV2Transaction[];
  error?: string;
}

export class TonCenterProvider implements TonProvider {
  public readonly name = 'toncenter';

  private readonly baseUrl: string;
  private readonly apiKey: string;
  /** Последний известный номер мастерчейн-блока — для подсчёта подтверждений. */
  private lastMasterchainSeqno = 0;

  constructor(baseUrl = env.ton.apiBaseUrl, apiKey = env.ton.apiKey) {
    // Базовый URL может быть задан как https://toncenter.com или .../api/v2
    this.baseUrl = baseUrl.replace(/\/+$/, '').replace(/\/api\/v[23]$/, '');
    this.apiKey = apiKey;
  }

  public isConfigured(): boolean {
    return Boolean(env.ton.walletAddress);
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (this.apiKey) headers['X-API-Key'] = this.apiKey;
    return headers;
  }

  public async getIncomingTransactions(params: FetchTransactionsParams): Promise<TonIncomingTransaction[]> {
    try {
      return await this.fetchV3(params);
    } catch (error) {
      logger.warn('toncenter v3 недоступен, пробуем v2', { error: (error as Error).message });
      return this.fetchV2(params);
    }
  }

  /* ------------------------------ v3 ------------------------------------- */

  private async fetchV3(params: FetchTransactionsParams): Promise<TonIncomingTransaction[]> {
    const url = new URL(`${this.baseUrl}/api/v3/transactions`);
    url.searchParams.set('account', params.address);
    url.searchParams.set('limit', String(Math.min(params.limit, 256)));
    url.searchParams.set('offset', '0');
    url.searchParams.set('sort', 'desc');
    if (params.sinceUtime) url.searchParams.set('start_utime', String(params.sinceUtime));

    const response = await fetch(url, { headers: this.headers(), signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error(`toncenter v3 вернул статус ${response.status}`);

    const data = (await response.json()) as TonCenterV3Response;
    if (data.error) throw new Error(`toncenter v3: ${data.error}`);

    const transactions = data.transactions ?? [];

    // Запоминаем самый свежий блок — по нему считаются подтверждения.
    for (const tx of transactions) {
      if (tx.mc_block_seqno && tx.mc_block_seqno > this.lastMasterchainSeqno) {
        this.lastMasterchainSeqno = tx.mc_block_seqno;
      }
    }

    return transactions
      .filter((tx) => {
        const msg = tx.in_msg;
        if (!msg || !msg.value || msg.value === '0') return false;
        // Отклонённые (bounced) переводы не зачисляем.
        if (msg.bounced === true) return false;
        // Транзакция должна быть успешно исполнена.
        if (tx.description?.aborted === true) return false;
        return true;
      })
      .map((tx) => ({
        hash: tx.hash,
        lt: tx.lt,
        amountNano: BigInt(tx.in_msg?.value ?? '0'),
        comment: this.extractV3Comment(tx.in_msg),
        sender: tx.in_msg?.source ?? null,
        destination: tx.in_msg?.destination ?? params.address,
        utime: tx.now,
        blockSeqno: tx.mc_block_seqno ?? null,
      }));
  }

  /** Комментарий из v3: сначала готовое поле, затем разбор тела сообщения. */
  private extractV3Comment(msg?: TonCenterV3Message | null): string | null {
    if (!msg) return null;

    const decoded = msg.message_content?.decoded;
    if (decoded && typeof decoded.comment === 'string' && decoded.comment.length > 0) {
      return decoded.comment;
    }

    const body = msg.message_content?.body;
    if (!body) return null;
    return decodeTextCell(body);
  }

  /* ------------------------------ v2 ------------------------------------- */

  private async fetchV2(params: FetchTransactionsParams): Promise<TonIncomingTransaction[]> {
    const url = new URL(`${this.baseUrl}/api/v2/getTransactions`);
    url.searchParams.set('address', params.address);
    url.searchParams.set('limit', String(Math.min(params.limit, 100)));
    url.searchParams.set('archival', 'true');

    const response = await fetch(url, { headers: this.headers(), signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error(`toncenter v2 вернул статус ${response.status}`);

    const data = (await response.json()) as TonCenterV2Response;
    if (!data.ok || !data.result) throw new Error(`toncenter v2: ${data.error ?? 'неизвестная ошибка'}`);

    return data.result
      .filter((tx) => tx.in_msg && tx.in_msg.value && tx.in_msg.value !== '0')
      .filter((tx) => (params.sinceUtime ? tx.utime >= params.sinceUtime : true))
      .map((tx) => ({
        hash: tx.transaction_id.hash,
        lt: tx.transaction_id.lt,
        amountNano: BigInt(tx.in_msg?.value ?? '0'),
        comment: this.extractV2Comment(tx.in_msg),
        sender: tx.in_msg?.source ?? null,
        destination: tx.in_msg?.destination ?? params.address,
        utime: tx.utime,
        blockSeqno: null,
      }));
  }

  private extractV2Comment(msg?: TonCenterV2Message): string | null {
    if (!msg) return null;
    if (typeof msg.message === 'string' && msg.message.length > 0) return msg.message;
    if (msg.msg_data?.text) return decodeBase64Text(msg.msg_data.text);
    if (msg.msg_data?.body) return decodeTextCell(msg.msg_data.body);
    return null;
  }

  /* -------------------------- Подтверждения ------------------------------ */

  /**
   * Количество подтверждений транзакции.
   * В TON транзакция финальна после включения в мастерчейн, поэтому за
   * подтверждения принимается разница номеров блоков; если номер неизвестен,
   * используется выдержка по времени.
   */
  public async getConfirmations(tx: TonIncomingTransaction): Promise<number> {
    if (tx.blockSeqno && this.lastMasterchainSeqno > 0) {
      return Math.max(1, this.lastMasterchainSeqno - tx.blockSeqno + 1);
    }

    try {
      const url = new URL(`${this.baseUrl}/api/v2/getMasterchainInfo`);
      const response = await fetch(url, { headers: this.headers(), signal: AbortSignal.timeout(10_000) });
      if (response.ok) {
        const data = (await response.json()) as { result?: { last?: { seqno?: number } } };
        const seqno = data.result?.last?.seqno;
        if (seqno && tx.blockSeqno) return Math.max(1, seqno - tx.blockSeqno + 1);
        if (seqno) this.lastMasterchainSeqno = seqno;
      }
    } catch (error) {
      logger.debug('Не удалось получить номер мастерчейн-блока', { error: (error as Error).message });
    }

    // Резервный вариант: выдержка по времени (5 секунд на «подтверждение»).
    const ageSeconds = Math.floor(Date.now() / 1000) - tx.utime;
    return ageSeconds >= 5 ? Math.max(1, Math.floor(ageSeconds / 5)) : 0;
  }
}

/* --------------------------- Разбор комментария --------------------------- */

/**
 * Извлекает текст из BOC-ячейки с текстовым комментарием.
 *
 * Текстовый комментарий в TON — это ячейка, начинающаяся с четырёх нулевых
 * байтов (опкод 0x00000000), после которых идёт UTF-8 текст. Полный разбор BOC
 * здесь не нужен: достаточно найти этот маркер и прочитать хвост.
 */
export function decodeTextCell(base64Body: string): string | null {
  try {
    const buffer = Buffer.from(base64Body, 'base64');
    const marker = buffer.indexOf(Buffer.from([0, 0, 0, 0]));
    if (marker < 0) return null;

    const text = buffer.subarray(marker + 4).toString('utf8');
    return normalizeComment(text);
  } catch {
    return null;
  }
}

/** Декодирует комментарий, пришедший обычной строкой base64. */
export function decodeBase64Text(base64: string): string | null {
  try {
    return normalizeComment(Buffer.from(base64, 'base64').toString('utf8'));
  } catch {
    return null;
  }
}

/** Убирает служебные символы и обрезает комментарий до разумной длины. */
export function normalizeComment(raw: string): string | null {
  const cleaned = raw
    // eslint-disable-next-line no-control-regex
    .replace(new RegExp('[\\u0000-\\u001F\\u007F]', 'g'), ' ')
    .replace(/�/g, '')
    .trim();
  return cleaned.length > 0 ? cleaned.slice(0, 256) : null;
}
