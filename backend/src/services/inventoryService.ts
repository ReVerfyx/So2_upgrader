/**
 * Инвентарь пользователя.
 * Все операции обязательно проверяют владельца предмета (ownership)
 * и текущий статус записи — клиенту доверять нельзя.
 */
import type { PoolClient } from 'pg';
import { pool } from '../db/pool';
import { query, queryOne, withTransaction, type Db } from '../db/tx';
import { conflict, forbidden, notFound } from '../lib/errors';
import { money, toBigInt, type MoneyDto } from '../lib/money';
import type { Condition, Rarity } from './itemService';
import { applyBalanceChange } from './balanceService';

export type InventoryStatus = 'available' | 'locked' | 'consumed' | 'withdrawn';

interface InventoryRow {
  id: string;
  user_id: string;
  item_id: string;
  status: InventoryStatus;
  condition: Condition;
  price_minor: string;
  acquired_from: string;
  source_id: string | null;
  created_at: Date;
  name: string;
  slug: string;
  weapon: string;
  rarity: Rarity;
  image_url: string;
  item_price_minor: string;
  is_withdrawable: boolean;
}

export interface InventoryItemDto {
  id: string;
  itemId: string;
  name: string;
  slug: string;
  weapon: string;
  rarity: Rarity;
  condition: Condition;
  imageUrl: string;
  status: InventoryStatus;
  price: MoneyDto;
  priceMinor: string;
  currentPrice: MoneyDto;
  acquiredFrom: string;
  isWithdrawable: boolean;
  createdAt: Date;
}

const SELECT_INVENTORY = `
  SELECT inv.*, i.name, i.slug, i.weapon, i.rarity, i.image_url,
         i.price_minor AS item_price_minor, i.is_withdrawable
    FROM inventory inv
    JOIN items i ON i.id = inv.item_id
`;

export function mapInventoryItem(row: InventoryRow): InventoryItemDto {
  return {
    id: row.id,
    itemId: row.item_id,
    name: row.name,
    slug: row.slug,
    weapon: row.weapon,
    rarity: row.rarity,
    condition: row.condition,
    imageUrl: row.image_url,
    status: row.status,
    price: money(toBigInt(row.price_minor)),
    priceMinor: row.price_minor,
    currentPrice: money(toBigInt(row.item_price_minor)),
    acquiredFrom: row.acquired_from,
    isWithdrawable: row.is_withdrawable,
    createdAt: row.created_at,
  };
}

export async function listInventory(params: {
  userId: string;
  status?: InventoryStatus | 'all';
  limit: number;
  offset: number;
  sort?: 'price_asc' | 'price_desc' | 'newest';
}): Promise<{ items: InventoryItemDto[]; total: number; totalValueMinor: bigint }> {
  const values: unknown[] = [params.userId];
  const filters = ['inv.user_id = $1'];

  if (!params.status || params.status === 'available') {
    filters.push(`inv.status = 'available'`);
  } else if (params.status !== 'all') {
    values.push(params.status);
    filters.push(`inv.status = $${values.length}`);
  } else {
    filters.push(`inv.status <> 'consumed'`);
  }

  const where = `WHERE ${filters.join(' AND ')}`;
  const order =
    params.sort === 'price_asc' ? 'inv.price_minor ASC' : params.sort === 'newest' ? 'inv.created_at DESC' : 'inv.price_minor DESC';

  const totals = await queryOne<{ count: string; sum: string | null }>(
    `SELECT count(*)::text AS count, sum(inv.price_minor)::text AS sum
       FROM inventory inv ${where}`,
    values,
  );

  values.push(params.limit, params.offset);
  const rows = await query<InventoryRow>(
    `${SELECT_INVENTORY} ${where} ORDER BY ${order}, inv.id ASC LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values,
  );

  return {
    items: rows.map(mapInventoryItem),
    total: Number(totals?.count ?? '0'),
    totalValueMinor: toBigInt(totals?.sum ?? '0'),
  };
}

export async function getInventoryItem(userId: string, inventoryId: string, db: Db = pool): Promise<InventoryItemDto> {
  const row = await queryOne<InventoryRow>(`${SELECT_INVENTORY} WHERE inv.id = $1`, [inventoryId], db);
  if (!row) throw notFound('Предмет инвентаря не найден', 'INVENTORY_ITEM_NOT_FOUND');
  if (row.user_id !== userId) throw forbidden('Этот предмет принадлежит другому пользователю', 'NOT_ITEM_OWNER');
  return mapInventoryItem(row);
}

/**
 * Блокирует запись инвентаря и проверяет владельца.
 * Используется в апгрейде и выводе, вызывать только внутри транзакции.
 */
export async function lockInventoryItem(
  userId: string,
  inventoryId: string,
  client: PoolClient,
): Promise<InventoryRow> {
  const row = await queryOne<InventoryRow>(
    `${SELECT_INVENTORY} WHERE inv.id = $1 FOR UPDATE OF inv`,
    [inventoryId],
    client,
  );
  if (!row) throw notFound('Предмет инвентаря не найден', 'INVENTORY_ITEM_NOT_FOUND');
  if (row.user_id !== userId) throw forbidden('Этот предмет принадлежит другому пользователю', 'NOT_ITEM_OWNER');
  if (row.status !== 'available') throw conflict('Предмет уже используется или выведен', 'ITEM_NOT_AVAILABLE');
  return row;
}

export async function addItemToInventory(
  params: {
    userId: string;
    itemId: string;
    priceMinor: bigint;
    condition: Condition;
    acquiredFrom: 'upgrade' | 'purchase' | 'admin' | 'bonus' | 'test' | 'system';
    sourceId?: string;
  },
  client: PoolClient,
): Promise<string> {
  const row = await queryOne<{ id: string }>(
    `INSERT INTO inventory (user_id, item_id, price_minor, condition, acquired_from, source_id)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [
      params.userId,
      params.itemId,
      params.priceMinor.toString(),
      params.condition,
      params.acquiredFrom,
      params.sourceId ?? null,
    ],
    client,
  );
  return row!.id;
}

export async function setInventoryStatus(
  inventoryId: string,
  status: InventoryStatus,
  client: PoolClient,
): Promise<void> {
  await query('UPDATE inventory SET status = $2 WHERE id = $1', [inventoryId, status], client);
}

/** Продажа предмета обратно площадке: предмет списывается, баланс пополняется. */
export async function sellInventoryItem(userId: string, inventoryId: string): Promise<{ amountMinor: bigint }> {
  return withTransaction(async (client) => {
    const row = await lockInventoryItem(userId, inventoryId, client);
    const amountMinor = toBigInt(row.price_minor);
    await setInventoryStatus(inventoryId, 'consumed', client);
    await applyBalanceChange(
      {
        userId,
        amountMinor,
        type: 'item_sell',
        referenceType: 'inventory',
        referenceId: inventoryId,
        metadata: { itemId: row.item_id, itemName: row.name },
      },
      client,
    );
    return { amountMinor };
  });
}
