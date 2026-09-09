/**
 * Заявки на вывод предметов.
 *
 * ЧЕСТНОСТЬ ФОРМУЛИРОВОК: выдача скина выполняется вручную оператором,
 * поэтому интерфейс не обещает «мгновенный автоматический вывод».
 * Пользователь видит реальный статус: «Заявка в очереди» → «В обработке» →
 * «Выполнена»/«Отклонена». Предмет на время обработки блокируется в инвентаре,
 * при отклонении — возвращается владельцу.
 */
import { pool } from '../db/pool';
import { query, queryOne, withTransaction, type Db } from '../db/tx';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors';
import { money, toBigInt, type MoneyDto } from '../lib/money';
import { sanitizeText } from '../lib/validate';
import { lockInventoryItem, setInventoryStatus } from './inventoryService';

export type WithdrawalStatus = 'pending' | 'processing' | 'completed' | 'rejected';

interface WithdrawalRow {
  id: string;
  user_id: string;
  inventory_id: string | null;
  item_id: string;
  item_name: string;
  price_minor: string;
  game_nickname: string;
  contact: string | null;
  status: WithdrawalStatus;
  admin_id: string | null;
  admin_comment: string | null;
  tx_hash: string | null;
  created_at: Date;
  updated_at: Date;
  processed_at: Date | null;
  image_url?: string;
  rarity?: string;
  username?: string;
  display_name?: string;
}

export interface WithdrawalDto {
  id: string;
  itemId: string;
  itemName: string;
  imageUrl: string | null;
  rarity: string | null;
  price: MoneyDto;
  gameNickname: string;
  contact: string | null;
  status: WithdrawalStatus;
  statusLabel: string;
  adminComment: string | null;
  txHash: string | null;
  createdAt: Date;
  processedAt: Date | null;
  /** Позиция в очереди (только для заявок в статусе «в очереди»). */
  queuePosition?: number;
  user?: { id: string; username: string; displayName: string };
}

const STATUS_LABELS: Record<WithdrawalStatus, string> = {
  pending: 'Заявка находится в очереди',
  processing: 'Заявка в обработке модератором',
  completed: 'Предмет выдан',
  rejected: 'Заявка отклонена',
};

function mapWithdrawal(row: WithdrawalRow, includeUser = false): WithdrawalDto {
  return {
    id: row.id,
    itemId: row.item_id,
    itemName: row.item_name,
    imageUrl: row.image_url ?? null,
    rarity: row.rarity ?? null,
    price: money(toBigInt(row.price_minor)),
    gameNickname: row.game_nickname,
    contact: row.contact,
    status: row.status,
    statusLabel: STATUS_LABELS[row.status],
    adminComment: row.admin_comment,
    txHash: row.tx_hash,
    createdAt: row.created_at,
    processedAt: row.processed_at,
    ...(includeUser && row.username
      ? { user: { id: row.user_id, username: row.username, displayName: row.display_name ?? row.username } }
      : {}),
  };
}

const SELECT_WITHDRAWAL = `
  SELECT w.*, i.image_url, i.rarity, u.username, u.display_name
    FROM withdrawals w
    JOIN items i ON i.id = w.item_id
    JOIN users u ON u.id = w.user_id
`;

/** Создание заявки: предмет блокируется, чтобы его нельзя было ещё и апнуть. */
export async function createWithdrawal(params: {
  userId: string;
  inventoryId: string;
  gameNickname: string;
  contact?: string;
}): Promise<WithdrawalDto> {
  const nickname = sanitizeText(params.gameNickname, 64);
  if (nickname.length < 3) {
    throw badRequest('Укажите игровой никнейм (не менее 3 символов)', 'INVALID_GAME_NICKNAME');
  }
  const contact = params.contact ? sanitizeText(params.contact, 128) : null;

  return withTransaction(async (client) => {
    const item = await lockInventoryItem(params.userId, params.inventoryId, client);
    if (!item.is_withdrawable) {
      throw conflict('Этот предмет нельзя вывести', 'ITEM_NOT_WITHDRAWABLE');
    }

    await setInventoryStatus(params.inventoryId, 'locked', client);

    const row = await queryOne<WithdrawalRow>(
      `INSERT INTO withdrawals (user_id, inventory_id, item_id, item_name, price_minor, game_nickname, contact)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        params.userId,
        params.inventoryId,
        item.item_id,
        item.name,
        item.price_minor,
        nickname,
        contact,
      ],
      client,
    );

    await query(
      'UPDATE users SET game_nickname = COALESCE(game_nickname, $2), contact = COALESCE(contact, $3) WHERE id = $1',
      [params.userId, nickname, contact],
      client,
    );

    return mapWithdrawal({ ...row!, image_url: item.image_url, rarity: item.rarity });
  });
}

export async function listUserWithdrawals(params: {
  userId: string;
  limit: number;
  offset: number;
}): Promise<{ items: WithdrawalDto[]; total: number }> {
  const totalRow = await queryOne<{ count: string }>(
    'SELECT count(*)::text AS count FROM withdrawals WHERE user_id = $1',
    [params.userId],
  );
  const rows = await query<WithdrawalRow>(
    `${SELECT_WITHDRAWAL} WHERE w.user_id = $1 ORDER BY w.created_at DESC LIMIT $2 OFFSET $3`,
    [params.userId, params.limit, params.offset],
  );

  const items = await Promise.all(
    rows.map(async (row) => {
      const dto = mapWithdrawal(row);
      if (row.status === 'pending') {
        const position = await queryOne<{ count: string }>(
          `SELECT count(*)::text AS count FROM withdrawals
            WHERE status = 'pending' AND created_at <= $1`,
          [row.created_at],
        );
        dto.queuePosition = Number(position?.count ?? '1');
      }
      return dto;
    }),
  );

  return { items, total: Number(totalRow?.count ?? '0') };
}

export async function getWithdrawal(userId: string, id: string): Promise<WithdrawalDto> {
  const row = await queryOne<WithdrawalRow>(`${SELECT_WITHDRAWAL} WHERE w.id = $1`, [id]);
  if (!row) throw notFound('Заявка не найдена', 'WITHDRAWAL_NOT_FOUND');
  if (row.user_id !== userId) throw forbidden('Заявка принадлежит другому пользователю', 'NOT_WITHDRAWAL_OWNER');
  return mapWithdrawal(row);
}

/** Отмена заявки пользователем — доступна только пока она в очереди. */
export async function cancelWithdrawal(userId: string, id: string): Promise<WithdrawalDto> {
  return withTransaction(async (client) => {
    const row = await queryOne<WithdrawalRow>('SELECT * FROM withdrawals WHERE id = $1 FOR UPDATE', [id], client);
    if (!row) throw notFound('Заявка не найдена', 'WITHDRAWAL_NOT_FOUND');
    if (row.user_id !== userId) throw forbidden('Заявка принадлежит другому пользователю', 'NOT_WITHDRAWAL_OWNER');
    if (row.status !== 'pending') {
      throw conflict('Заявку уже взяли в обработку — отмена невозможна', 'WITHDRAWAL_NOT_CANCELABLE');
    }

    const updated = await queryOne<WithdrawalRow>(
      `UPDATE withdrawals
          SET status = 'rejected', admin_comment = 'Отменена пользователем', processed_at = now()
        WHERE id = $1 RETURNING *`,
      [id],
      client,
    );
    if (row.inventory_id) await setInventoryStatus(row.inventory_id, 'available', client);
    return mapWithdrawal(updated!);
  });
}

/* ------------------------------ Админ-функции ---------------------------- */

export async function listAllWithdrawals(params: {
  status?: WithdrawalStatus;
  search?: string;
  limit: number;
  offset: number;
  db?: Db;
}): Promise<{ items: WithdrawalDto[]; total: number }> {
  const db = params.db ?? pool;
  const values: unknown[] = [];
  const filters: string[] = [];

  if (params.status) {
    values.push(params.status);
    filters.push(`w.status = $${values.length}`);
  }
  if (params.search) {
    values.push(`%${params.search.toLowerCase()}%`);
    filters.push(`(lower(u.username) LIKE $${values.length} OR lower(w.item_name) LIKE $${values.length} OR lower(w.game_nickname) LIKE $${values.length})`);
  }
  const where = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : '';

  const totalRow = await queryOne<{ count: string }>(
    `SELECT count(*)::text AS count FROM withdrawals w JOIN users u ON u.id = w.user_id ${where}`,
    values,
    db,
  );

  values.push(params.limit, params.offset);
  const rows = await query<WithdrawalRow>(
    `${SELECT_WITHDRAWAL} ${where}
      ORDER BY CASE w.status WHEN 'pending' THEN 0 WHEN 'processing' THEN 1 ELSE 2 END, w.created_at ASC
      LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values,
    db,
  );

  return { items: rows.map((row) => mapWithdrawal(row, true)), total: Number(totalRow?.count ?? '0') };
}

/** Перевод заявки в статус «в обработке». */
export async function takeWithdrawal(id: string, adminId: string): Promise<WithdrawalDto> {
  const row = await queryOne<WithdrawalRow>(
    `UPDATE withdrawals SET status = 'processing', admin_id = $2
      WHERE id = $1 AND status = 'pending' RETURNING *`,
    [id, adminId],
  );
  if (!row) throw conflict('Заявку нельзя взять в работу в текущем статусе', 'WITHDRAWAL_INVALID_STATE');
  return mapWithdrawal(row);
}

/** Завершение выдачи: предмет окончательно списывается из инвентаря. */
export async function completeWithdrawal(params: {
  id: string;
  adminId: string;
  txHash?: string;
  comment?: string;
}): Promise<WithdrawalDto> {
  return withTransaction(async (client) => {
    const row = await queryOne<WithdrawalRow>(
      'SELECT * FROM withdrawals WHERE id = $1 FOR UPDATE',
      [params.id],
      client,
    );
    if (!row) throw notFound('Заявка не найдена', 'WITHDRAWAL_NOT_FOUND');
    if (row.status === 'completed') throw conflict('Заявка уже выполнена', 'WITHDRAWAL_ALREADY_COMPLETED');
    if (row.status === 'rejected') throw conflict('Заявка отклонена', 'WITHDRAWAL_REJECTED');

    if (row.inventory_id) await setInventoryStatus(row.inventory_id, 'withdrawn', client);

    const updated = await queryOne<WithdrawalRow>(
      `UPDATE withdrawals
          SET status = 'completed', admin_id = $2, tx_hash = $3,
              admin_comment = COALESCE($4, admin_comment), processed_at = now()
        WHERE id = $1 RETURNING *`,
      [params.id, params.adminId, params.txHash ?? null, params.comment ? sanitizeText(params.comment, 500) : null],
      client,
    );
    return mapWithdrawal(updated!);
  });
}

/** Отклонение заявки: предмет возвращается пользователю. */
export async function rejectWithdrawal(params: {
  id: string;
  adminId: string;
  comment: string;
}): Promise<WithdrawalDto> {
  const comment = sanitizeText(params.comment, 500);
  if (comment.length < 3) throw badRequest('Укажите причину отклонения', 'REJECT_REASON_REQUIRED');

  return withTransaction(async (client) => {
    const row = await queryOne<WithdrawalRow>(
      'SELECT * FROM withdrawals WHERE id = $1 FOR UPDATE',
      [params.id],
      client,
    );
    if (!row) throw notFound('Заявка не найдена', 'WITHDRAWAL_NOT_FOUND');
    if (row.status === 'completed') throw conflict('Заявка уже выполнена', 'WITHDRAWAL_ALREADY_COMPLETED');

    if (row.inventory_id) await setInventoryStatus(row.inventory_id, 'available', client);

    const updated = await queryOne<WithdrawalRow>(
      `UPDATE withdrawals
          SET status = 'rejected', admin_id = $2, admin_comment = $3, processed_at = now()
        WHERE id = $1 RETURNING *`,
      [params.id, params.adminId, comment],
      client,
    );
    return mapWithdrawal(updated!);
  });
}
