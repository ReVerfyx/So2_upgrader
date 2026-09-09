/** Каталог предметов: выборка, фильтры, управление из админ-панели. */
import { pool } from '../db/pool';
import { query, queryOne, type Db } from '../db/tx';
import { notFound } from '../lib/errors';
import { money, toBigInt, type MoneyDto } from '../lib/money';

export type Rarity = 'common' | 'rare' | 'epic' | 'legendary' | 'arcane' | 'contraband';
export type Condition = 'factory_new' | 'minimal_wear' | 'field_tested' | 'well_worn' | 'battle_scarred';

export interface ItemRow {
  id: string;
  slug: string;
  name: string;
  weapon: string;
  rarity: Rarity;
  condition: Condition;
  image_url: string;
  price_nano: string;
  is_active: boolean;
  is_withdrawable: boolean;
  description: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface ItemDto {
  id: string;
  slug: string;
  name: string;
  weapon: string;
  rarity: Rarity;
  condition: Condition;
  imageUrl: string;
  price: MoneyDto;
  priceNano: string;
  isActive: boolean;
  isWithdrawable: boolean;
  description: string | null;
}

export function mapItem(row: ItemRow): ItemDto {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    weapon: row.weapon,
    rarity: row.rarity,
    condition: row.condition,
    imageUrl: row.image_url,
    price: money(toBigInt(row.price_nano)),
    priceNano: row.price_nano,
    isActive: row.is_active,
    isWithdrawable: row.is_withdrawable,
    description: row.description,
  };
}

export interface ListItemsParams {
  search?: string;
  rarity?: Rarity;
  weapon?: string;
  minPriceNano?: bigint;
  maxPriceNano?: bigint;
  sort?: 'price_asc' | 'price_desc' | 'name_asc' | 'newest';
  limit: number;
  offset: number;
  includeInactive?: boolean;
}

export async function listItems(params: ListItemsParams, db: Db = pool): Promise<{ items: ItemDto[]; total: number }> {
  const filters: string[] = [];
  const values: unknown[] = [];

  if (!params.includeInactive) filters.push('is_active = TRUE');
  if (params.search) {
    values.push(`%${params.search.toLowerCase()}%`);
    filters.push(`(lower(name) LIKE $${values.length} OR lower(weapon) LIKE $${values.length})`);
  }
  if (params.rarity) {
    values.push(params.rarity);
    filters.push(`rarity = $${values.length}`);
  }
  if (params.weapon) {
    values.push(params.weapon);
    filters.push(`weapon = $${values.length}`);
  }
  if (params.minPriceNano !== undefined) {
    values.push(params.minPriceNano.toString());
    filters.push(`price_nano >= $${values.length}`);
  }
  if (params.maxPriceNano !== undefined) {
    values.push(params.maxPriceNano.toString());
    filters.push(`price_nano <= $${values.length}`);
  }

  const where = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : '';
  const order =
    params.sort === 'price_desc'
      ? 'price_nano DESC'
      : params.sort === 'name_asc'
        ? 'name ASC'
        : params.sort === 'newest'
          ? 'created_at DESC'
          : 'price_nano ASC';

  const totalRow = await queryOne<{ count: string }>(`SELECT count(*)::text AS count FROM items ${where}`, values, db);

  values.push(params.limit, params.offset);
  const rows = await query<ItemRow>(
    `SELECT * FROM items ${where} ORDER BY ${order}, id ASC LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values,
    db,
  );

  return { items: rows.map(mapItem), total: Number(totalRow?.count ?? '0') };
}

export async function getItem(id: string, db: Db = pool): Promise<ItemDto> {
  const row = await queryOne<ItemRow>('SELECT * FROM items WHERE id = $1', [id], db);
  if (!row) throw notFound('Предмет не найден', 'ITEM_NOT_FOUND');
  return mapItem(row);
}

export async function getItemRaw(id: string, db: Db = pool): Promise<ItemRow | null> {
  return queryOne<ItemRow>('SELECT * FROM items WHERE id = $1', [id], db);
}

/** Список доступных типов оружия — для фильтров интерфейса. */
export async function listWeapons(db: Db = pool): Promise<string[]> {
  const rows = await query<{ weapon: string }>(
    'SELECT DISTINCT weapon FROM items WHERE is_active = TRUE ORDER BY weapon',
    [],
    db,
  );
  return rows.map((row) => row.weapon);
}

export interface UpsertItemInput {
  slug: string;
  name: string;
  weapon: string;
  rarity: Rarity;
  condition: Condition;
  imageUrl: string;
  priceNano: bigint;
  isActive: boolean;
  isWithdrawable: boolean;
  description?: string | null;
}

export async function createItem(input: UpsertItemInput, db: Db = pool): Promise<ItemDto> {
  const row = await queryOne<ItemRow>(
    `INSERT INTO items (slug, name, weapon, rarity, condition, image_url, price_nano, is_active, is_withdrawable, description)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING *`,
    [
      input.slug,
      input.name,
      input.weapon,
      input.rarity,
      input.condition,
      input.imageUrl,
      input.priceNano.toString(),
      input.isActive,
      input.isWithdrawable,
      input.description ?? null,
    ],
    db,
  );
  return mapItem(row!);
}

export async function updateItem(id: string, patch: Partial<UpsertItemInput>, db: Db = pool): Promise<ItemDto> {
  const row = await queryOne<ItemRow>(
    `UPDATE items SET
        name            = COALESCE($2, name),
        weapon          = COALESCE($3, weapon),
        rarity          = COALESCE($4, rarity),
        condition       = COALESCE($5, condition),
        image_url       = COALESCE($6, image_url),
        price_nano      = COALESCE($7, price_nano),
        is_active       = COALESCE($8, is_active),
        is_withdrawable = COALESCE($9, is_withdrawable),
        description     = COALESCE($10, description)
      WHERE id = $1
      RETURNING *`,
    [
      id,
      patch.name ?? null,
      patch.weapon ?? null,
      patch.rarity ?? null,
      patch.condition ?? null,
      patch.imageUrl ?? null,
      patch.priceNano?.toString() ?? null,
      patch.isActive ?? null,
      patch.isWithdrawable ?? null,
      patch.description ?? null,
    ],
    db,
  );
  if (!row) throw notFound('Предмет не найден', 'ITEM_NOT_FOUND');
  return mapItem(row);
}
