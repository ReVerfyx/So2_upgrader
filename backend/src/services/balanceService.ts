/**
 * Баланс пользователя.
 *
 * ЕДИНСТВЕННОЕ место в системе, где меняется баланс. Правила:
 *  - любое изменение выполняется внутри транзакции БД;
 *  - строка баланса блокируется через SELECT ... FOR UPDATE,
 *    поэтому параллельные запросы не могут списать/начислить дважды;
 *  - каждое изменение сопровождается записью в журнал transactions
 *    со старым и новым значением баланса;
 *  - баланс не может уйти в минус (ограничение на уровне БД и кода).
 */
import type { PoolClient } from 'pg';
import { query, queryOne } from '../db/tx';
import { conflict } from '../lib/errors';
import { toBigInt } from '../lib/money';

export type TransactionType =
  | 'deposit'
  | 'withdrawal'
  | 'upgrade_stake'
  | 'upgrade_win'
  | 'upgrade_loss'
  | 'item_sell'
  | 'admin_adjust'
  | 'refund'
  | 'bonus'
  | 'test_credit';

export interface BalanceSnapshot {
  amountNano: bigint;
  lockedNano: bigint;
  currency: string;
}

export interface LedgerEntry {
  id: string;
  type: TransactionType;
  amountNano: bigint;
  balanceBeforeNano: bigint;
  balanceAfterNano: bigint;
  status: string;
  referenceType: string | null;
  referenceId: string | null;
  txHash: string | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
}

interface BalanceRow {
  amount_nano: string;
  locked_nano: string;
  currency: string;
}

/** Читает баланс без блокировки (для отображения). */
export async function getBalance(userId: string, db: PoolClient | undefined = undefined): Promise<BalanceSnapshot> {
  const row = await queryOne<BalanceRow>(
    `SELECT amount_nano, locked_nano, currency FROM balances WHERE user_id = $1 AND currency = 'TON'`,
    [userId],
    db,
  );
  if (!row) return { amountNano: 0n, lockedNano: 0n, currency: 'TON' };
  return {
    amountNano: toBigInt(row.amount_nano),
    lockedNano: toBigInt(row.locked_nano),
    currency: row.currency,
  };
}

/** Блокирует строку баланса до конца транзакции. Создаёт её при отсутствии. */
export async function lockBalance(userId: string, client: PoolClient): Promise<BalanceSnapshot> {
  let row = await queryOne<BalanceRow>(
    `SELECT amount_nano, locked_nano, currency FROM balances
      WHERE user_id = $1 AND currency = 'TON' FOR UPDATE`,
    [userId],
    client,
  );
  if (!row) {
    await query(
      `INSERT INTO balances (user_id, currency) VALUES ($1, 'TON') ON CONFLICT (user_id, currency) DO NOTHING`,
      [userId],
      client,
    );
    row = await queryOne<BalanceRow>(
      `SELECT amount_nano, locked_nano, currency FROM balances
        WHERE user_id = $1 AND currency = 'TON' FOR UPDATE`,
      [userId],
      client,
    );
  }
  return {
    amountNano: toBigInt(row!.amount_nano),
    lockedNano: toBigInt(row!.locked_nano),
    currency: row!.currency,
  };
}

export interface ApplyChangeParams {
  userId: string;
  /** Положительная сумма — начисление, отрицательная — списание. */
  amountNano: bigint;
  type: TransactionType;
  referenceType?: string;
  referenceId?: string;
  txHash?: string;
  status?: 'pending' | 'completed' | 'failed' | 'cancelled';
  metadata?: Record<string, unknown>;
}

export interface ApplyChangeResult {
  transactionId: string;
  balanceBeforeNano: bigint;
  balanceAfterNano: bigint;
}

/**
 * Атомарно изменяет баланс и пишет запись в журнал.
 * Вызывать только внутри withTransaction.
 */
export async function applyBalanceChange(
  params: ApplyChangeParams,
  client: PoolClient,
): Promise<ApplyChangeResult> {
  const before = await lockBalance(params.userId, client);
  const after = before.amountNano + params.amountNano;

  if (after < 0n) {
    throw conflict('Недостаточно средств на балансе', 'INSUFFICIENT_FUNDS');
  }

  await query(
    `UPDATE balances SET amount_nano = $2, updated_at = now() WHERE user_id = $1 AND currency = 'TON'`,
    [params.userId, after.toString()],
    client,
  );

  const row = await queryOne<{ id: string }>(
    `INSERT INTO transactions (user_id, type, amount_nano, balance_before_nano, balance_after_nano,
                               status, reference_type, reference_id, tx_hash, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
     RETURNING id`,
    [
      params.userId,
      params.type,
      params.amountNano.toString(),
      before.amountNano.toString(),
      after.toString(),
      params.status ?? 'completed',
      params.referenceType ?? null,
      params.referenceId ?? null,
      params.txHash ?? null,
      JSON.stringify(params.metadata ?? {}),
    ],
    client,
  );

  return { transactionId: row!.id, balanceBeforeNano: before.amountNano, balanceAfterNano: after };
}

interface TransactionRow {
  id: string;
  type: TransactionType;
  amount_nano: string;
  balance_before_nano: string;
  balance_after_nano: string;
  status: string;
  reference_type: string | null;
  reference_id: string | null;
  tx_hash: string | null;
  metadata: Record<string, unknown>;
  created_at: Date;
}

function mapTransaction(row: TransactionRow): LedgerEntry {
  return {
    id: row.id,
    type: row.type,
    amountNano: toBigInt(row.amount_nano),
    balanceBeforeNano: toBigInt(row.balance_before_nano),
    balanceAfterNano: toBigInt(row.balance_after_nano),
    status: row.status,
    referenceType: row.reference_type,
    referenceId: row.reference_id,
    txHash: row.tx_hash,
    metadata: row.metadata ?? {},
    createdAt: row.created_at,
  };
}

export async function listTransactions(params: {
  userId: string;
  limit: number;
  offset: number;
  type?: TransactionType;
}): Promise<{ items: LedgerEntry[]; total: number }> {
  const filters: string[] = ['user_id = $1'];
  const values: unknown[] = [params.userId];
  if (params.type) {
    values.push(params.type);
    filters.push(`type = $${values.length}`);
  }
  const where = filters.join(' AND ');

  const totalRow = await queryOne<{ count: string }>(
    `SELECT count(*)::text AS count FROM transactions WHERE ${where}`,
    values,
  );

  values.push(params.limit, params.offset);
  const rows = await query<TransactionRow>(
    `SELECT * FROM transactions WHERE ${where}
      ORDER BY created_at DESC
      LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values,
  );

  return { items: rows.map(mapTransaction), total: Number(totalRow?.count ?? '0') };
}
