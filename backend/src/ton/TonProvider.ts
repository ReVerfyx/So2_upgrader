/**
 * Абстракция доступа к блокчейну TON.
 *
 * Позволяет подключить любого провайдера (toncenter, tonapi, собственная нода)
 * без изменения бизнес-логики. Ключ API задаётся переменной окружения
 * TON_API_KEY и в коде не хранится.
 */

export interface TonIncomingTransaction {
  /** Уникальный хеш транзакции — используется как ключ идемпотентности. */
  hash: string;
  /** Сумма перевода в нанотонах. */
  amountNano: bigint;
  /** Комментарий (memo) — в нём приходит идентификатор платежа. */
  comment: string | null;
  /** Адрес отправителя. */
  sender: string | null;
  /** Адрес получателя. */
  destination: string;
  /** Время транзакции, unix-секунды. */
  utime: number;
  /** Логическое время — для корректной сортировки внутри блока. */
  lt: string;
  /** Номер мастерчейн-блока, если известен (для подсчёта подтверждений). */
  blockSeqno?: number | null;
}

export interface FetchTransactionsParams {
  address: string;
  limit: number;
  /** Не запрашивать транзакции старше указанного времени (unix-секунды). */
  sinceUtime?: number;
}

export interface TonProvider {
  readonly name: string;
  /** Готов ли провайдер к работе (заданы адрес и, при необходимости, ключ). */
  isConfigured(): boolean;
  /** Входящие транзакции на адрес площадки, новые сверху. */
  getIncomingTransactions(params: FetchTransactionsParams): Promise<TonIncomingTransaction[]>;
  /** Текущее количество подтверждений транзакции (мастерчейн-сейф). */
  getConfirmations(tx: TonIncomingTransaction): Promise<number>;
}
