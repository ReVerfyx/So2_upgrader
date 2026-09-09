/**
 * Административные операции.
 * Каждое действие администратора логируется в admin_logs
 * (кто, что, над чем, с какими параметрами и с какого IP).
 */
import { pool } from '../db/pool';
import { query, queryOne, withTransaction, type Db } from '../db/tx';
import { badRequest, conflict, notFound } from '../lib/errors';
import { money, toBigInt, type MoneyDto } from '../lib/money';
import { sanitizeText } from '../lib/validate';
import { applyBalanceChange } from './balanceService';
import { revokeAllUserSessions } from './authService';

export interface AdminUserDto {
  id: string;
  username: string;
  displayName: string;
  email: string | null;
  role: 'user' | 'admin';
  isBlocked: boolean;
  blockReason: string | null;
  balance: MoneyDto;
  inventoryCount: number;
  upgradesCount: number;
  depositedTotal: MoneyDto;
  authProvider: string;
  createdAt: Date;
  lastLoginAt: Date | null;
}

interface AdminUserRow {
  id: string;
  username: string;
  display_name: string;
  email: string | null;
  role: 'user' | 'admin';
  is_blocked: boolean;
  block_reason: string | null;
  external_provider: string | null;
  amount_nano: string | null;
  inventory_count: string;
  upgrades_count: string;
  deposited_total: string | null;
  created_at: Date;
  last_login_at: Date | null;
}

function mapAdminUser(row: AdminUserRow): AdminUserDto {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    email: row.email,
    role: row.role,
    isBlocked: row.is_blocked,
    blockReason: row.block_reason,
    balance: money(toBigInt(row.amount_nano ?? '0')),
    inventoryCount: Number(row.inventory_count),
    upgradesCount: Number(row.upgrades_count),
    depositedTotal: money(toBigInt(row.deposited_total ?? '0')),
    authProvider: row.external_provider ?? 'password',
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at,
  };
}

export async function listUsers(params: {
  search?: string;
  blocked?: boolean;
  limit: number;
  offset: number;
}): Promise<{ items: AdminUserDto[]; total: number }> {
  const values: unknown[] = [];
  const filters: string[] = [];

  if (params.search) {
    values.push(`%${params.search.toLowerCase()}%`);
    filters.push(`(lower(u.username) LIKE $${values.length} OR lower(u.display_name) LIKE $${values.length} OR lower(coalesce(u.email, '')) LIKE $${values.length})`);
  }
  if (params.blocked !== undefined) {
    values.push(params.blocked);
    filters.push(`u.is_blocked = $${values.length}`);
  }
  const where = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : '';

  const totalRow = await queryOne<{ count: string }>(
    `SELECT count(*)::text AS count FROM users u ${where}`,
    values,
  );

  values.push(params.limit, params.offset);
  const rows = await query<AdminUserRow>(
    `SELECT u.id, u.username, u.display_name, u.email, u.role, u.is_blocked, u.block_reason,
            u.external_provider, u.created_at, u.last_login_at,
            b.amount_nano,
            (SELECT count(*)::text FROM inventory inv WHERE inv.user_id = u.id AND inv.status = 'available') AS inventory_count,
            (SELECT count(*)::text FROM upgrades up WHERE up.user_id = u.id) AS upgrades_count,
            (SELECT coalesce(sum(d.received_nano), 0)::text FROM deposits d WHERE d.user_id = u.id AND d.status = 'confirmed') AS deposited_total
       FROM users u
       LEFT JOIN balances b ON b.user_id = u.id AND b.currency = 'TON'
       ${where}
      ORDER BY u.created_at DESC
      LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values,
  );

  return { items: rows.map(mapAdminUser), total: Number(totalRow?.count ?? '0') };
}

export async function getUserDetails(userId: string): Promise<AdminUserDto> {
  const result = await listUsers({ limit: 1, offset: 0, search: undefined });
  const direct = result.items.find((user) => user.id === userId);
  if (direct) return direct;

  const row = await queryOne<AdminUserRow>(
    `SELECT u.id, u.username, u.display_name, u.email, u.role, u.is_blocked, u.block_reason,
            u.external_provider, u.created_at, u.last_login_at, b.amount_nano,
            (SELECT count(*)::text FROM inventory inv WHERE inv.user_id = u.id AND inv.status = 'available') AS inventory_count,
            (SELECT count(*)::text FROM upgrades up WHERE up.user_id = u.id) AS upgrades_count,
            (SELECT coalesce(sum(d.received_nano), 0)::text FROM deposits d WHERE d.user_id = u.id AND d.status = 'confirmed') AS deposited_total
       FROM users u
       LEFT JOIN balances b ON b.user_id = u.id AND b.currency = 'TON'
      WHERE u.id = $1`,
    [userId],
  );
  if (!row) throw notFound('Пользователь не найден', 'USER_NOT_FOUND');
  return mapAdminUser(row);
}

/** Блокировка/разблокировка пользователя. Активные сессии сбрасываются. */
export async function setUserBlocked(params: {
  userId: string;
  blocked: boolean;
  reason?: string;
}): Promise<AdminUserDto> {
  const reason = params.reason ? sanitizeText(params.reason, 300) : null;

  await withTransaction(async (client) => {
    const updated = await queryOne<{ id: string }>(
      'UPDATE users SET is_blocked = $2, block_reason = $3 WHERE id = $1 RETURNING id',
      [params.userId, params.blocked, params.blocked ? reason : null],
      client,
    );
    if (!updated) throw notFound('Пользователь не найден', 'USER_NOT_FOUND');
    if (params.blocked) await revokeAllUserSessions(params.userId, client);
  });

  return getUserDetails(params.userId);
}

/** Ручная корректировка баланса с обязательным комментарием. */
export async function adjustBalance(params: {
  userId: string;
  amountNano: bigint;
  reason: string;
  adminId: string;
}): Promise<{ balance: MoneyDto; transactionId: string }> {
  const reason = sanitizeText(params.reason, 300);
  if (reason.length < 3) throw badRequest('Укажите причину корректировки', 'REASON_REQUIRED');
  if (params.amountNano === 0n) throw badRequest('Сумма корректировки не может быть нулевой', 'ZERO_AMOUNT');

  return withTransaction(async (client) => {
    const user = await queryOne<{ id: string }>('SELECT id FROM users WHERE id = $1 FOR UPDATE', [params.userId], client);
    if (!user) throw notFound('Пользователь не найден', 'USER_NOT_FOUND');

    const result = await applyBalanceChange(
      {
        userId: params.userId,
        amountNano: params.amountNano,
        type: 'admin_adjust',
        referenceType: 'admin',
        referenceId: params.adminId,
        metadata: { reason, adminId: params.adminId },
      },
      client,
    );

    return { balance: money(result.balanceAfterNano), transactionId: result.transactionId };
  });
}

/** Выдача предмета пользователю вручную. */
export async function grantItem(params: {
  userId: string;
  itemId: string;
  adminId: string;
}): Promise<{ inventoryId: string }> {
  return withTransaction(async (client) => {
    const item = await queryOne<{ id: string; price_nano: string; condition: string }>(
      'SELECT id, price_nano, condition FROM items WHERE id = $1',
      [params.itemId],
      client,
    );
    if (!item) throw notFound('Предмет не найден', 'ITEM_NOT_FOUND');

    const row = await queryOne<{ id: string }>(
      `INSERT INTO inventory (user_id, item_id, price_nano, condition, acquired_from, source_id)
       VALUES ($1, $2, $3, $4, 'admin', $5) RETURNING id`,
      [params.userId, item.id, item.price_nano, item.condition, params.adminId],
      client,
    );
    return { inventoryId: row!.id };
  });
}

/** Удаление предмета из инвентаря пользователя (например, при откате ошибки). */
export async function revokeInventoryItem(inventoryId: string): Promise<void> {
  const row = await queryOne<{ id: string; status: string }>(
    'SELECT id, status FROM inventory WHERE id = $1',
    [inventoryId],
  );
  if (!row) throw notFound('Предмет инвентаря не найден', 'INVENTORY_ITEM_NOT_FOUND');
  if (row.status === 'locked') throw conflict('Предмет находится в заявке на вывод', 'ITEM_LOCKED');
  await query(`UPDATE inventory SET status = 'consumed' WHERE id = $1`, [inventoryId]);
}

/* ------------------------------ Журналы ---------------------------------- */

export async function logAdminAction(params: {
  adminId: string;
  action: string;
  targetType?: string;
  targetId?: string;
  payload?: Record<string, unknown>;
  ip?: string;
  db?: Db;
}): Promise<void> {
  await query(
    `INSERT INTO admin_logs (admin_id, action, target_type, target_id, payload, ip)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
    [
      params.adminId,
      params.action,
      params.targetType ?? null,
      params.targetId ?? null,
      JSON.stringify(params.payload ?? {}),
      params.ip ?? null,
    ],
    params.db ?? pool,
  );
}

export async function listAdminLogs(params: {
  limit: number;
  offset: number;
  action?: string;
}): Promise<{ items: unknown[]; total: number }> {
  const values: unknown[] = [];
  let where = '';
  if (params.action) {
    values.push(params.action);
    where = `WHERE l.action = $${values.length}`;
  }

  const totalRow = await queryOne<{ count: string }>(
    `SELECT count(*)::text AS count FROM admin_logs l ${where}`,
    values,
  );

  values.push(params.limit, params.offset);
  const items = await query(
    `SELECT l.id, l.action, l.target_type, l.target_id, l.payload, l.ip, l.created_at,
            u.username AS admin_username
       FROM admin_logs l
       LEFT JOIN users u ON u.id = l.admin_id
       ${where}
      ORDER BY l.created_at DESC
      LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values,
  );

  return { items, total: Number(totalRow?.count ?? '0') };
}

export async function listErrorLogs(params: {
  limit: number;
  offset: number;
  level?: 'warn' | 'error' | 'fatal';
}): Promise<{ items: unknown[]; total: number }> {
  const values: unknown[] = [];
  let where = '';
  if (params.level) {
    values.push(params.level);
    where = `WHERE level = $${values.length}`;
  }

  const totalRow = await queryOne<{ count: string }>(
    `SELECT count(*)::text AS count FROM error_logs ${where}`,
    values,
  );

  values.push(params.limit, params.offset);
  const items = await query(
    `SELECT id, level, code, message, context, request_id, user_id, created_at
       FROM error_logs ${where}
      ORDER BY created_at DESC
      LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values,
  );

  return { items, total: Number(totalRow?.count ?? '0') };
}

/* ------------------------------ Сводка ----------------------------------- */

export interface AdminStats {
  users: { total: number; blocked: number; newToday: number };
  balance: { totalNano: MoneyDto };
  deposits: { pending: number; confirmedTotal: MoneyDto; today: MoneyDto };
  withdrawals: { pending: number; processing: number; completed: number };
  upgrades: { total: number; today: number; winRate: number };
  errors: { last24h: number };
}

export async function getAdminStats(): Promise<AdminStats> {
  const row = await queryOne<Record<string, string | null>>(
    `SELECT
      (SELECT count(*)::text FROM users) AS users_total,
      (SELECT count(*)::text FROM users WHERE is_blocked) AS users_blocked,
      (SELECT count(*)::text FROM users WHERE created_at > now() - interval '1 day') AS users_new,
      (SELECT coalesce(sum(amount_nano), 0)::text FROM balances) AS balance_total,
      (SELECT count(*)::text FROM deposits WHERE status = 'pending') AS deposits_pending,
      (SELECT coalesce(sum(received_nano), 0)::text FROM deposits WHERE status = 'confirmed') AS deposits_total,
      (SELECT coalesce(sum(received_nano), 0)::text FROM deposits WHERE status = 'confirmed' AND confirmed_at > now() - interval '1 day') AS deposits_today,
      (SELECT count(*)::text FROM withdrawals WHERE status = 'pending') AS wd_pending,
      (SELECT count(*)::text FROM withdrawals WHERE status = 'processing') AS wd_processing,
      (SELECT count(*)::text FROM withdrawals WHERE status = 'completed') AS wd_completed,
      (SELECT count(*)::text FROM upgrades) AS up_total,
      (SELECT count(*)::text FROM upgrades WHERE created_at > now() - interval '1 day') AS up_today,
      (SELECT count(*)::text FROM upgrades WHERE success) AS up_wins,
      (SELECT count(*)::text FROM error_logs WHERE created_at > now() - interval '1 day') AS errors_24h`,
  );

  const num = (key: string): number => Number(row?.[key] ?? '0');
  const upTotal = num('up_total');

  return {
    users: { total: num('users_total'), blocked: num('users_blocked'), newToday: num('users_new') },
    balance: { totalNano: money(toBigInt(row?.balance_total ?? '0')) },
    deposits: {
      pending: num('deposits_pending'),
      confirmedTotal: money(toBigInt(row?.deposits_total ?? '0')),
      today: money(toBigInt(row?.deposits_today ?? '0')),
    },
    withdrawals: { pending: num('wd_pending'), processing: num('wd_processing'), completed: num('wd_completed') },
    upgrades: {
      total: upTotal,
      today: num('up_today'),
      winRate: upTotal > 0 ? Math.round((num('up_wins') / upTotal) * 10000) / 100 : 0,
    },
    errors: { last24h: num('errors_24h') },
  };
}

/** Все апгрейды площадки — для раздела «Upgrade-история». */
export async function listAllUpgrades(params: {
  limit: number;
  offset: number;
  userId?: string;
  onlyWins?: boolean;
}): Promise<{ items: unknown[]; total: number }> {
  const values: unknown[] = [];
  const filters: string[] = [];
  if (params.userId) {
    values.push(params.userId);
    filters.push(`up.user_id = $${values.length}`);
  }
  if (params.onlyWins) filters.push('up.success = TRUE');
  const where = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : '';

  const totalRow = await queryOne<{ count: string }>(
    `SELECT count(*)::text AS count FROM upgrades up ${where}`,
    values,
  );

  values.push(params.limit, params.offset);
  const rows = await query<Record<string, unknown>>(
    `SELECT up.id, up.created_at, up.success, up.chance_ppm, up.roll_ppm, up.multiplier_bp,
            up.source_price_nano, up.target_price_nano, up.source_type,
            u.username, ti.name AS target_name
       FROM upgrades up
       JOIN users u ON u.id = up.user_id
       JOIN items ti ON ti.id = up.target_item_id
       ${where}
      ORDER BY up.created_at DESC
      LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values,
  );

  const items = rows.map((row) => ({
    id: row.id,
    createdAt: row.created_at,
    username: row.username,
    targetName: row.target_name,
    sourceType: row.source_type,
    success: row.success,
    chancePercent: Number(row.chance_ppm) / 10_000,
    rollPercent: Number(row.roll_ppm) / 10_000,
    multiplier: Number(row.multiplier_bp) / 10_000,
    sourcePrice: money(toBigInt(row.source_price_nano)),
    targetPrice: money(toBigInt(row.target_price_nano)),
  }));

  return { items, total: Number(totalRow?.count ?? '0') };
}

/** Все пополнения — для раздела «Просмотр платежей». */
export async function listAllDeposits(params: {
  limit: number;
  offset: number;
  status?: string;
}): Promise<{ items: unknown[]; total: number }> {
  const values: unknown[] = [];
  let where = '';
  if (params.status) {
    values.push(params.status);
    where = `WHERE d.status = $${values.length}`;
  }

  const totalRow = await queryOne<{ count: string }>(
    `SELECT count(*)::text AS count FROM deposits d ${where}`,
    values,
  );

  values.push(params.limit, params.offset);
  const rows = await query<Record<string, unknown>>(
    `SELECT d.id, d.payment_id, d.status, d.amount_nano, d.received_nano, d.tx_hash,
            d.created_at, d.confirmed_at, d.expires_at, u.username, u.id AS user_id
       FROM deposits d JOIN users u ON u.id = d.user_id
       ${where}
      ORDER BY d.created_at DESC
      LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values,
  );

  const items = rows.map((row) => ({
    id: row.id,
    paymentId: row.payment_id,
    status: row.status,
    amount: money(toBigInt(row.amount_nano)),
    received: money(toBigInt(row.received_nano)),
    txHash: row.tx_hash,
    username: row.username,
    userId: row.user_id,
    createdAt: row.created_at,
    confirmedAt: row.confirmed_at,
    expiresAt: row.expires_at,
  }));

  return { items, total: Number(totalRow?.count ?? '0') };
}
