/**
 * Пополнение баланса через TON.
 *
 * КАК ЭТО РАБОТАЕТ (и почему нельзя «нарисовать» себе баланс):
 *  1. Пользователь создаёт счёт: сервер выдаёт адрес кошелька площадки,
 *     сумму и уникальный идентификатор платежа (комментарий к переводу).
 *  2. Пользователь отправляет перевод с этим комментарием.
 *  3. Фоновый воркер сам опрашивает блокчейн и ищет входящие транзакции.
 *  4. Зачисление происходит только если транзакция реально найдена
 *     в блокчейне, комментарий совпал, сумма достаточна и набрано нужное
 *     число подтверждений.
 *
 * Данные из браузера НЕ участвуют в подтверждении: запрос вида amount=100
 * не даст ничего — сумма проверяется по фактической транзакции.
 * Повторное зачисление невозможно: hash транзакции уникален (UNIQUE-индекс),
 * а статус меняется в транзакции БД с блокировкой строки счёта.
 */
import crypto from 'node:crypto';
import QRCode from 'qrcode';
import type { PoolClient } from 'pg';
import { pool } from '../db/pool';
import { query, queryOne, withTransaction, type Db } from '../db/tx';
import { env } from '../config/env';
import { AppError, badRequest, conflict, notFound } from '../lib/errors';
import { logger } from '../lib/logger';
import { money, nanoToTon, toBigInt, type MoneyDto } from '../lib/money';
import { getDepositSettings } from './settingsService';
import { applyBalanceChange } from './balanceService';
import type { TonIncomingTransaction } from '../ton/TonProvider';

export type DepositStatus = 'pending' | 'confirmed' | 'failed' | 'expired';

interface DepositRow {
  id: string;
  user_id: string;
  payment_id: string;
  wallet_address: string;
  amount_nano: string;
  received_nano: string;
  status: DepositStatus;
  tx_hash: string | null;
  sender_address: string | null;
  confirmations: number;
  metadata: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
  expires_at: Date;
  confirmed_at: Date | null;
}

export interface DepositDto {
  id: string;
  paymentId: string;
  walletAddress: string;
  amount: MoneyDto;
  amountTon: string;
  received: MoneyDto;
  status: DepositStatus;
  txHash: string | null;
  confirmations: number;
  createdAt: Date;
  expiresAt: Date;
  confirmedAt: Date | null;
  /** Секунд до истечения счёта (0, если истёк). */
  secondsLeft: number;
  /** Ссылка ton:// для кошелька. */
  paymentUrl: string;
  /** QR-код в виде data:image/png;base64. */
  qrCode?: string;
}

function mapDeposit(row: DepositRow): DepositDto {
  const amountNano = toBigInt(row.amount_nano);
  const secondsLeft = Math.max(0, Math.floor((new Date(row.expires_at).getTime() - Date.now()) / 1000));
  return {
    id: row.id,
    paymentId: row.payment_id,
    walletAddress: row.wallet_address,
    amount: money(amountNano),
    amountTon: nanoToTon(amountNano),
    received: money(toBigInt(row.received_nano)),
    status: row.status,
    txHash: row.tx_hash,
    confirmations: row.confirmations,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    confirmedAt: row.confirmed_at,
    secondsLeft: row.status === 'pending' ? secondsLeft : 0,
    paymentUrl: buildPaymentUrl(row.wallet_address, amountNano, row.payment_id),
  };
}

/** Ссылка для кошельков TON (Tonkeeper, Tonhub и др.). */
export function buildPaymentUrl(address: string, amountNano: bigint, comment: string): string {
  const url = new URL(`ton://transfer/${address}`);
  url.searchParams.set('amount', amountNano.toString());
  url.searchParams.set('text', comment);
  return url.toString();
}

/** Уникальный человекочитаемый идентификатор платежа. */
function generatePaymentId(): string {
  const random = crypto.randomBytes(5).toString('hex').toUpperCase();
  return `SO2-${random}`;
}

export function getWalletAddress(): string {
  if (!env.ton.walletAddress) {
    throw new AppError('Пополнение временно недоступно: не настроен кошелёк площадки', {
      status: 503,
      code: 'TON_WALLET_NOT_CONFIGURED',
    });
  }
  return env.ton.walletAddress;
}

/** Создание счёта на пополнение. */
export async function createDeposit(params: { userId: string; amountNano: bigint }): Promise<DepositDto> {
  const settings = await getDepositSettings();
  const walletAddress = getWalletAddress();

  if (params.amountNano < settings.minDepositNano) {
    throw badRequest(
      `Минимальная сумма пополнения — ${nanoToTon(settings.minDepositNano)} TON`,
      'DEPOSIT_AMOUNT_TOO_SMALL',
    );
  }
  if (params.amountNano > 1_000_000n * 1_000_000_000n) {
    throw badRequest('Слишком большая сумма пополнения', 'DEPOSIT_AMOUNT_TOO_LARGE');
  }

  // Не даём плодить бесконечные счета: не более 5 активных одновременно.
  const activeCount = await queryOne<{ count: string }>(
    `SELECT count(*)::text AS count FROM deposits
      WHERE user_id = $1 AND status = 'pending' AND expires_at > now()`,
    [params.userId],
  );
  if (Number(activeCount?.count ?? '0') >= 5) {
    throw conflict('Слишком много неоплаченных счетов. Дождитесь оплаты или истечения срока.', 'TOO_MANY_PENDING_DEPOSITS');
  }

  const expiresAt = new Date(Date.now() + settings.ttlMinutes * 60_000);

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const paymentId = generatePaymentId();
    const existing = await queryOne('SELECT 1 FROM deposits WHERE payment_id = $1', [paymentId]);
    if (existing) continue;

    const row = await queryOne<DepositRow>(
      `INSERT INTO deposits (user_id, payment_id, wallet_address, amount_nano, expires_at, metadata)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)
       RETURNING *`,
      [
        params.userId,
        paymentId,
        walletAddress,
        params.amountNano.toString(),
        expiresAt,
        JSON.stringify({ provider: env.ton.provider, minConfirmations: settings.minConfirmations }),
      ],
    );
    return withQrCode(mapDeposit(row!));
  }

  throw new AppError('Не удалось создать счёт на пополнение, попробуйте ещё раз', {
    status: 500,
    code: 'DEPOSIT_ID_COLLISION',
  });
}

/** Добавляет QR-код к DTO (генерируется на сервере, без внешних сервисов). */
export async function withQrCode(deposit: DepositDto): Promise<DepositDto> {
  const qrCode = await QRCode.toDataURL(deposit.paymentUrl, {
    width: 320,
    margin: 1,
    color: { dark: '#101012', light: '#ffffff' },
  });
  return { ...deposit, qrCode };
}

export async function getDeposit(userId: string, depositId: string): Promise<DepositDto> {
  const row = await queryOne<DepositRow>('SELECT * FROM deposits WHERE id = $1', [depositId]);
  if (!row || row.user_id !== userId) throw notFound('Счёт на пополнение не найден', 'DEPOSIT_NOT_FOUND');

  // Ленивое протухание: если срок вышел — фиксируем это в базе.
  if (row.status === 'pending' && new Date(row.expires_at).getTime() < Date.now()) {
    await query(`UPDATE deposits SET status = 'expired' WHERE id = $1 AND status = 'pending'`, [row.id]);
    row.status = 'expired';
  }

  return withQrCode(mapDeposit(row));
}

export async function listDeposits(params: {
  userId: string;
  limit: number;
  offset: number;
}): Promise<{ items: DepositDto[]; total: number }> {
  const totalRow = await queryOne<{ count: string }>(
    'SELECT count(*)::text AS count FROM deposits WHERE user_id = $1',
    [params.userId],
  );
  const rows = await query<DepositRow>(
    'SELECT * FROM deposits WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3',
    [params.userId, params.limit, params.offset],
  );
  return { items: rows.map(mapDeposit), total: Number(totalRow?.count ?? '0') };
}

/** Помечает истёкшие счета. Вызывается воркером. */
export async function expireStaleDeposits(db: Db = pool): Promise<number> {
  const rows = await query<{ id: string }>(
    `UPDATE deposits SET status = 'expired'
      WHERE status = 'pending' AND expires_at < now()
      RETURNING id`,
    [],
    db,
  );
  return rows.length;
}

export interface CreditResult {
  credited: boolean;
  depositId?: string;
  reason?: string;
}

/**
 * Зачисление реальной транзакции блокчейна.
 *
 * Идемпотентность обеспечивается на двух уровнях:
 *  - проверка существующего tx_hash перед зачислением;
 *  - UNIQUE-индекс deposits.tx_hash на уровне БД (гонки исключены).
 */
export async function creditTransaction(tx: TonIncomingTransaction, confirmations: number): Promise<CreditResult> {
  const comment = tx.comment?.trim();
  if (!comment) return { credited: false, reason: 'Транзакция без комментария' };

  const settings = await getDepositSettings();
  if (confirmations < settings.minConfirmations) {
    return { credited: false, reason: 'Недостаточно подтверждений' };
  }

  // Уже зачтено ранее.
  const known = await queryOne<{ id: string }>('SELECT id FROM deposits WHERE tx_hash = $1', [tx.hash]);
  if (known) return { credited: false, reason: 'Транзакция уже обработана', depositId: known.id };

  const paymentId = comment.toUpperCase().match(/SO2-[A-F0-9]{10}/)?.[0];
  if (!paymentId) return { credited: false, reason: 'Комментарий не содержит идентификатор платежа' };

  return withTransaction(async (client: PoolClient) => {
    const deposit = await queryOne<DepositRow>(
      'SELECT * FROM deposits WHERE payment_id = $1 FOR UPDATE',
      [paymentId],
      client,
    );
    if (!deposit) return { credited: false, reason: `Счёт ${paymentId} не найден` };
    if (deposit.status === 'confirmed') {
      return { credited: false, reason: 'Счёт уже оплачен', depositId: deposit.id };
    }
    if (deposit.status === 'failed') {
      return { credited: false, reason: 'Счёт отменён', depositId: deposit.id };
    }

    const expectedNano = toBigInt(deposit.amount_nano);
    // Допускаем небольшую недоплату из-за комиссии сети (0.5%).
    const tolerance = expectedNano / 200n;
    if (tx.amountNano + tolerance < expectedNano) {
      await query(
        `UPDATE deposits SET received_nano = $2, metadata = metadata || $3::jsonb
          WHERE id = $1`,
        [
          deposit.id,
          tx.amountNano.toString(),
          JSON.stringify({ underpaid: true, txHash: tx.hash, receivedNano: tx.amountNano.toString() }),
        ],
        client,
      );
      return { credited: false, reason: 'Сумма перевода меньше суммы счёта', depositId: deposit.id };
    }

    // Зачисляем фактически полученную сумму, а не заявленную в браузере.
    const creditNano = tx.amountNano;

    await applyBalanceChange(
      {
        userId: deposit.user_id,
        amountNano: creditNano,
        type: 'deposit',
        referenceType: 'deposit',
        referenceId: deposit.id,
        txHash: tx.hash,
        metadata: {
          paymentId: deposit.payment_id,
          sender: tx.sender,
          confirmations,
          utime: tx.utime,
        },
      },
      client,
    );

    await query(
      `UPDATE deposits
          SET status = 'confirmed', received_nano = $2, tx_hash = $3, sender_address = $4,
              confirmations = $5, confirmed_at = now()
        WHERE id = $1`,
      [deposit.id, creditNano.toString(), tx.hash, tx.sender, confirmations],
      client,
    );

    logger.info('Пополнение подтверждено', {
      depositId: deposit.id,
      paymentId: deposit.payment_id,
      amountNano: creditNano.toString(),
      txHash: tx.hash,
    });

    return { credited: true, depositId: deposit.id };
  });
}

/** Ручное подтверждение администратором (например, при нестандартном платеже). */
export async function adminConfirmDeposit(params: {
  depositId: string;
  adminId: string;
  txHash: string;
  amountNano?: bigint;
  comment?: string;
}): Promise<DepositDto> {
  return withTransaction(async (client) => {
    const deposit = await queryOne<DepositRow>(
      'SELECT * FROM deposits WHERE id = $1 FOR UPDATE',
      [params.depositId],
      client,
    );
    if (!deposit) throw notFound('Счёт не найден', 'DEPOSIT_NOT_FOUND');
    if (deposit.status === 'confirmed') throw conflict('Счёт уже подтверждён', 'DEPOSIT_ALREADY_CONFIRMED');

    const creditNano = params.amountNano ?? toBigInt(deposit.amount_nano);

    await applyBalanceChange(
      {
        userId: deposit.user_id,
        amountNano: creditNano,
        type: 'deposit',
        referenceType: 'deposit',
        referenceId: deposit.id,
        txHash: params.txHash,
        metadata: { manual: true, adminId: params.adminId, comment: params.comment ?? null },
      },
      client,
    );

    const updated = await queryOne<DepositRow>(
      `UPDATE deposits
          SET status = 'confirmed', received_nano = $2, tx_hash = $3, confirmed_at = now(),
              metadata = metadata || $4::jsonb
        WHERE id = $1
        RETURNING *`,
      [
        deposit.id,
        creditNano.toString(),
        params.txHash,
        JSON.stringify({ manualConfirmation: true, adminId: params.adminId }),
      ],
      client,
    );
    return mapDeposit(updated!);
  });
}
