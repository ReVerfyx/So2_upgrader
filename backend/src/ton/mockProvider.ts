/**
 * Провайдер-заглушка для разработки и тестов.
 *
 * Транзакции добавляются вручную через dev-эндпоинт
 * POST /api/dev/ton/simulate-payment, после чего проходят ровно тот же путь
 * проверки и зачисления, что и настоящие платежи. Доступен только при
 * TEST_MODE=true и NODE_ENV !== production.
 */
import crypto from 'node:crypto';
import type { FetchTransactionsParams, TonIncomingTransaction, TonProvider } from './TonProvider';

export class MockTonProvider implements TonProvider {
  public readonly name = 'mock';
  private transactions: TonIncomingTransaction[] = [];

  public isConfigured(): boolean {
    return true;
  }

  /** Добавляет «входящую» транзакцию, как будто она пришла из блокчейна. */
  public pushTransaction(params: {
    amountNano: bigint;
    comment: string;
    destination: string;
    sender?: string;
  }): TonIncomingTransaction {
    const tx: TonIncomingTransaction = {
      hash: crypto.randomBytes(32).toString('hex'),
      lt: String(Date.now()),
      amountNano: params.amountNano,
      comment: params.comment,
      sender: params.sender ?? 'EQmock_sender_address_for_development_only',
      destination: params.destination,
      utime: Math.floor(Date.now() / 1000),
    };
    this.transactions.unshift(tx);
    this.transactions = this.transactions.slice(0, 200);
    return tx;
  }

  public async getIncomingTransactions(params: FetchTransactionsParams): Promise<TonIncomingTransaction[]> {
    return this.transactions
      .filter((tx) => (params.sinceUtime ? tx.utime >= params.sinceUtime : true))
      .slice(0, params.limit);
  }

  public async getConfirmations(): Promise<number> {
    return 1;
  }

  public reset(): void {
    this.transactions = [];
  }
}
