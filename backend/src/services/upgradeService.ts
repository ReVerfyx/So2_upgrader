/**
 * Апгрейд — ключевая механика площадки.
 *
 * ГАРАНТИИ ЧЕСТНОСТИ (см. также lib/fairness.ts и lib/upgradeMath.ts):
 *
 *  1. Шанс считает сервер по формуле, одинаковой для предпросмотра и для игры.
 *     Клиент может прислать шанс, который он видел на экране
 *     (`expectedChancePpm`); если он не совпал с серверным — игра отклоняется,
 *     деньги не списываются. Так пользователь всегда играет ровно с тем
 *     шансом, который ему показали.
 *  2. Результат определяется до анимации: HMAC-SHA256(server_seed,
 *     client_seed:nonce) → число 0..999999. Успех, если число < шанса.
 *  3. Хеш server_seed опубликован ДО игры, само семя раскрывается после
 *     ротации — тогда любую прошлую игру можно пересчитать вручную.
 *  4. Всё выполняется в одной транзакции БД с блокировкой строк пользователя,
 *     баланса и предмета: параллельные запросы не могут сыграть одним
 *     предметом дважды.
 *  5. Клиент не передаёт ни цену, ни результат, ни идентификатор транзакции —
 *     эти значения формируются исключительно на сервере.
 */
import type { PoolClient } from 'pg';
import { pool } from '../db/pool';
import { query, queryOne, withTransaction } from '../db/tx';
import { badRequest, conflict, notFound } from '../lib/errors';
import { isSuccess, rollPpm } from '../lib/fairness';
import { money, toBigInt, type MoneyDto } from '../lib/money';
import { calculateUpgrade, targetPriceRange, UpgradeMathError } from '../lib/upgradeMath';
import { getUpgradeSettings } from './settingsService';
import { applyBalanceChange, lockBalance } from './balanceService';
import { addItemToInventory, lockInventoryItem, setInventoryStatus } from './inventoryService';
import { mapItem, type ItemDto, type ItemRow } from './itemService';

export type UpgradeSourceType = 'item' | 'balance';

export interface UpgradeRequest {
  userId: string;
  sourceType: UpgradeSourceType;
  /** Для sourceType = 'item'. */
  sourceInventoryId?: string;
  /** Для sourceType = 'balance', в нанотонах. */
  stakeNano?: bigint;
  targetItemId: string;
  /** Шанс, показанный пользователю на экране (миллионные доли). */
  expectedChancePpm?: number;
}

export interface UpgradeQuoteDto {
  sourceType: UpgradeSourceType;
  sourceName: string;
  sourcePrice: MoneyDto;
  sourcePriceNano: string;
  target: ItemDto;
  chancePpm: number;
  chancePercent: number;
  multiplier: number;
  multiplierBp: number;
  profit: MoneyDto;
  potentialWin: MoneyDto;
}

export interface UpgradeResultDto {
  id: string;
  success: boolean;
  chancePpm: number;
  chancePercent: number;
  /** Позиция «стрелки» в миллионных долях — по ней строится анимация. */
  rollPpm: number;
  rollPercent: number;
  multiplier: number;
  target: ItemDto;
  sourceName: string;
  sourcePrice: MoneyDto;
  wonInventoryId: string | null;
  balanceAfter: MoneyDto;
  fairness: {
    serverSeedHash: string;
    clientSeed: string;
    nonce: number;
    /** Раскрывается только после ротации серверного семени. */
    serverSeed: string | null;
  };
  createdAt: Date;
}

interface UserSeedRow {
  id: string;
  server_seed: string;
  server_seed_hash: string;
  client_seed: string;
  nonce: string;
}

/** Проверка и нормализация ставки балансом. */
function assertStake(stakeNano: bigint | undefined, minStakeNano: bigint): bigint {
  if (stakeNano === undefined) throw badRequest('Не указана сумма ставки', 'STAKE_REQUIRED');
  if (stakeNano < minStakeNano) {
    throw badRequest(`Минимальная ставка — ${money(minStakeNano).formatted} TON`, 'STAKE_TOO_SMALL');
  }
  return stakeNano;
}

/**
 * Предпросмотр апгрейда: те же вычисления, что и в реальной игре.
 * Ничего не списывает и не меняет.
 */
export async function previewUpgrade(request: Omit<UpgradeRequest, 'expectedChancePpm'>): Promise<UpgradeQuoteDto> {
  const settings = await getUpgradeSettings();

  let sourcePriceNano: bigint;
  let sourceName: string;

  if (request.sourceType === 'item') {
    if (!request.sourceInventoryId) throw badRequest('Не выбран предмет для апгрейда', 'SOURCE_ITEM_REQUIRED');
    const row = await queryOne<{ user_id: string; status: string; name: string; price_nano: string }>(
      `SELECT inv.user_id, inv.status, i.name, i.price_nano
         FROM inventory inv JOIN items i ON i.id = inv.item_id
        WHERE inv.id = $1`,
      [request.sourceInventoryId],
    );
    if (!row || row.user_id !== request.userId) throw notFound('Предмет инвентаря не найден', 'INVENTORY_ITEM_NOT_FOUND');
    if (row.status !== 'available') throw conflict('Предмет недоступен для апгрейда', 'ITEM_NOT_AVAILABLE');
    sourcePriceNano = toBigInt(row.price_nano);
    sourceName = row.name;
  } else {
    sourcePriceNano = assertStake(request.stakeNano, settings.minStakeNano);
    sourceName = `Ставка ${money(sourcePriceNano).formatted} TON`;
  }

  const targetRow = await queryOne<ItemRow>('SELECT * FROM items WHERE id = $1 AND is_active = TRUE', [
    request.targetItemId,
  ]);
  if (!targetRow) throw notFound('Желаемый предмет не найден', 'TARGET_ITEM_NOT_FOUND');

  const targetPriceNano = toBigInt(targetRow.price_nano);

  try {
    const quote = calculateUpgrade(sourcePriceNano, targetPriceNano, settings);
    return {
      sourceType: request.sourceType,
      sourceName,
      sourcePrice: money(sourcePriceNano),
      sourcePriceNano: sourcePriceNano.toString(),
      target: mapItem(targetRow),
      chancePpm: quote.chancePpm,
      chancePercent: quote.chancePercent,
      multiplier: quote.multiplier,
      multiplierBp: quote.multiplierBp,
      profit: money(quote.profitNano),
      potentialWin: money(targetPriceNano),
    };
  } catch (error) {
    if (error instanceof UpgradeMathError) throw badRequest(error.message, error.code);
    throw error;
  }
}

/** Список предметов, доступных как цель для указанной ставки. */
export async function listTargets(params: {
  sourcePriceNano: bigint;
  search?: string;
  limit: number;
  offset: number;
}): Promise<{ items: Array<ItemDto & { chancePercent: number; multiplier: number }>; total: number }> {
  const settings = await getUpgradeSettings();
  const range = targetPriceRange(params.sourcePriceNano, settings);

  const values: unknown[] = [range.minNano.toString(), range.maxNano.toString()];
  let where = 'WHERE is_active = TRUE AND price_nano >= $1 AND price_nano <= $2';
  if (params.search) {
    values.push(`%${params.search.toLowerCase()}%`);
    where += ` AND lower(name) LIKE $${values.length}`;
  }

  const totalRow = await queryOne<{ count: string }>(`SELECT count(*)::text AS count FROM items ${where}`, values);

  values.push(params.limit, params.offset);
  const rows = await query<ItemRow>(
    `SELECT * FROM items ${where} ORDER BY price_nano ASC LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values,
  );

  const items = rows.map((row) => {
    const quote = calculateUpgrade(params.sourcePriceNano, toBigInt(row.price_nano), settings);
    return { ...mapItem(row), chancePercent: quote.chancePercent, multiplier: quote.multiplier };
  });

  return { items, total: Number(totalRow?.count ?? '0') };
}

/**
 * Выполняет апгрейд. Возвращает уже готовый результат —
 * фронтенд только проигрывает анимацию под этот ответ.
 */
export async function performUpgrade(request: UpgradeRequest): Promise<UpgradeResultDto> {
  const settings = await getUpgradeSettings();

  return withTransaction(async (client: PoolClient) => {
    // 1. Блокируем пользователя: nonce увеличивается строго последовательно.
    const seedRow = await queryOne<UserSeedRow>(
      `SELECT id, server_seed, server_seed_hash, client_seed, nonce
         FROM users WHERE id = $1 FOR UPDATE`,
      [request.userId],
      client,
    );
    if (!seedRow) throw notFound('Пользователь не найден', 'USER_NOT_FOUND');

    // 2. Определяем ставку. Цена берётся ТОЛЬКО из базы, не из запроса.
    let sourcePriceNano: bigint;
    let sourceName: string;
    let sourceItemId: string | null = null;
    let sourceInventoryId: string | null = null;

    if (request.sourceType === 'item') {
      if (!request.sourceInventoryId) throw badRequest('Не выбран предмет для апгрейда', 'SOURCE_ITEM_REQUIRED');
      const inventoryRow = await lockInventoryItem(request.userId, request.sourceInventoryId, client);
      sourcePriceNano = toBigInt(inventoryRow.item_price_nano);
      sourceName = inventoryRow.name;
      sourceItemId = inventoryRow.item_id;
      sourceInventoryId = inventoryRow.id;
    } else {
      sourcePriceNano = assertStake(request.stakeNano, settings.minStakeNano);
      sourceName = `Ставка ${money(sourcePriceNano).formatted} TON`;
      const balance = await lockBalance(request.userId, client);
      if (balance.amountNano < sourcePriceNano) {
        throw conflict('Недостаточно средств на балансе', 'INSUFFICIENT_FUNDS');
      }
    }

    // 3. Целевой предмет и расчёт шанса.
    const targetRow = await queryOne<ItemRow>(
      'SELECT * FROM items WHERE id = $1 AND is_active = TRUE FOR SHARE',
      [request.targetItemId],
      client,
    );
    if (!targetRow) throw notFound('Желаемый предмет не найден', 'TARGET_ITEM_NOT_FOUND');
    const targetPriceNano = toBigInt(targetRow.price_nano);

    let quote;
    try {
      quote = calculateUpgrade(sourcePriceNano, targetPriceNano, settings);
    } catch (error) {
      if (error instanceof UpgradeMathError) throw badRequest(error.message, error.code);
      throw error;
    }

    // 4. Сверка с шансом, который видел пользователь.
    if (request.expectedChancePpm !== undefined && request.expectedChancePpm !== quote.chancePpm) {
      throw conflict(
        `Условия изменились: сейчас шанс ${(quote.chancePpm / 10_000).toFixed(2)}%. Обновите страницу и попробуйте снова.`,
        'CHANCE_MISMATCH',
      );
    }

    // 5. Списываем ставку.
    if (request.sourceType === 'balance') {
      await applyBalanceChange(
        {
          userId: request.userId,
          amountNano: -sourcePriceNano,
          type: 'upgrade_stake',
          referenceType: 'upgrade',
          metadata: { targetItemId: targetRow.id, chancePpm: quote.chancePpm },
        },
        client,
      );
    } else if (sourceInventoryId) {
      await setInventoryStatus(sourceInventoryId, 'consumed', client);
    }

    // 6. Генерация результата (сервер, CSPRNG-семя, проверяемый HMAC).
    const nonce = Number(seedRow.nonce) + 1;
    const roll = rollPpm(seedRow.server_seed, seedRow.client_seed, nonce);
    const success = isSuccess(roll, quote.chancePpm);

    await query('UPDATE users SET nonce = $2 WHERE id = $1', [request.userId, nonce], client);

    // 7. Выдача выигрыша.
    let wonInventoryId: string | null = null;
    if (success) {
      wonInventoryId = await addItemToInventory(
        {
          userId: request.userId,
          itemId: targetRow.id,
          priceNano: targetPriceNano,
          condition: targetRow.condition,
          acquiredFrom: 'upgrade',
        },
        client,
      );
    }

    // 8. Фиксация игры.
    const upgradeRow = await queryOne<{ id: string; created_at: Date }>(
      `INSERT INTO upgrades (user_id, source_type, source_inventory_id, source_item_id, source_price_nano,
                             target_item_id, target_price_nano, multiplier_bp, chance_ppm, roll_ppm,
                             success, result_inventory_id, server_seed, server_seed_hash, client_seed, nonce)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
       RETURNING id, created_at`,
      [
        request.userId,
        request.sourceType,
        sourceInventoryId,
        sourceItemId,
        sourcePriceNano.toString(),
        targetRow.id,
        targetPriceNano.toString(),
        quote.multiplierBp,
        quote.chancePpm,
        roll,
        success,
        wonInventoryId,
        seedRow.server_seed,
        seedRow.server_seed_hash,
        seedRow.client_seed,
        nonce,
      ],
      client,
    );

    if (wonInventoryId) {
      await query('UPDATE inventory SET source_id = $2 WHERE id = $1', [wonInventoryId, upgradeRow!.id], client);
    }

    const balance = await lockBalance(request.userId, client);

    return {
      id: upgradeRow!.id,
      success,
      chancePpm: quote.chancePpm,
      chancePercent: quote.chancePercent,
      rollPpm: roll,
      rollPercent: roll / 10_000,
      multiplier: quote.multiplier,
      target: mapItem(targetRow),
      sourceName,
      sourcePrice: money(sourcePriceNano),
      wonInventoryId,
      balanceAfter: money(balance.amountNano),
      fairness: {
        serverSeedHash: seedRow.server_seed_hash,
        clientSeed: seedRow.client_seed,
        nonce,
        serverSeed: null,
      },
      createdAt: upgradeRow!.created_at,
    };
  });
}

interface UpgradeHistoryRow {
  id: string;
  user_id: string;
  source_type: UpgradeSourceType;
  source_price_nano: string;
  target_price_nano: string;
  multiplier_bp: number;
  chance_ppm: number;
  roll_ppm: number;
  success: boolean;
  revealed: boolean;
  server_seed: string;
  server_seed_hash: string;
  client_seed: string;
  nonce: string;
  created_at: Date;
  target_name: string;
  target_image: string;
  target_rarity: string;
  source_name: string | null;
  username: string;
  display_name: string;
  avatar_url: string | null;
}

export interface UpgradeHistoryDto {
  id: string;
  sourceType: UpgradeSourceType;
  sourceName: string;
  sourcePrice: MoneyDto;
  targetName: string;
  targetImage: string;
  targetRarity: string;
  targetPrice: MoneyDto;
  chancePercent: number;
  rollPercent: number;
  multiplier: number;
  success: boolean;
  createdAt: Date;
  fairness: {
    serverSeedHash: string;
    clientSeed: string;
    nonce: number;
    serverSeed: string | null;
  };
  user?: { username: string; displayName: string; avatarUrl: string | null };
}

const SELECT_HISTORY = `
  SELECT up.*, ti.name AS target_name, ti.image_url AS target_image, ti.rarity AS target_rarity,
         si.name AS source_name, u.username, u.display_name, u.avatar_url
    FROM upgrades up
    JOIN items ti ON ti.id = up.target_item_id
    LEFT JOIN items si ON si.id = up.source_item_id
    JOIN users u ON u.id = up.user_id
`;

function mapHistory(row: UpgradeHistoryRow, includeUser: boolean): UpgradeHistoryDto {
  return {
    id: row.id,
    sourceType: row.source_type,
    sourceName: row.source_name ?? `Ставка ${money(toBigInt(row.source_price_nano)).formatted} TON`,
    sourcePrice: money(toBigInt(row.source_price_nano)),
    targetName: row.target_name,
    targetImage: row.target_image,
    targetRarity: row.target_rarity,
    targetPrice: money(toBigInt(row.target_price_nano)),
    chancePercent: row.chance_ppm / 10_000,
    rollPercent: row.roll_ppm / 10_000,
    multiplier: row.multiplier_bp / 10_000,
    success: row.success,
    createdAt: row.created_at,
    fairness: {
      serverSeedHash: row.server_seed_hash,
      clientSeed: row.client_seed,
      nonce: Number(row.nonce),
      // Семя показывается только если оно уже выведено из оборота.
      serverSeed: row.revealed ? row.server_seed : null,
    },
    ...(includeUser
      ? { user: { username: row.username, displayName: row.display_name, avatarUrl: row.avatar_url } }
      : {}),
  };
}

export async function listUserUpgrades(params: {
  userId: string;
  limit: number;
  offset: number;
}): Promise<{ items: UpgradeHistoryDto[]; total: number }> {
  const totalRow = await queryOne<{ count: string }>(
    'SELECT count(*)::text AS count FROM upgrades WHERE user_id = $1',
    [params.userId],
  );
  const rows = await query<UpgradeHistoryRow>(
    `${SELECT_HISTORY} WHERE up.user_id = $1 ORDER BY up.created_at DESC LIMIT $2 OFFSET $3`,
    [params.userId, params.limit, params.offset],
  );
  return { items: rows.map((row) => mapHistory(row, false)), total: Number(totalRow?.count ?? '0') };
}

/** Лента последних выигрышей всех игроков — для главной страницы. */
export async function listRecentWins(limit: number): Promise<UpgradeHistoryDto[]> {
  const rows = await query<UpgradeHistoryRow>(
    `${SELECT_HISTORY} WHERE up.success = TRUE ORDER BY up.created_at DESC LIMIT $1`,
    [limit],
  );
  return rows.map((row) => mapHistory(row, true));
}

export async function getUpgrade(userId: string, upgradeId: string): Promise<UpgradeHistoryDto> {
  const row = await queryOne<UpgradeHistoryRow>(`${SELECT_HISTORY} WHERE up.id = $1`, [upgradeId]);
  if (!row || row.user_id !== userId) throw notFound('Апгрейд не найден', 'UPGRADE_NOT_FOUND');
  return mapHistory(row, false);
}

/** Статистика пользователя для профиля. */
export async function getUserUpgradeStats(userId: string): Promise<{
  total: number;
  wins: number;
  losses: number;
  winRate: number;
  bestWin: MoneyDto;
  wagered: MoneyDto;
}> {
  const row = await queryOne<{
    total: string;
    wins: string;
    wagered: string | null;
    best: string | null;
  }>(
    `SELECT count(*)::text AS total,
            count(*) FILTER (WHERE success)::text AS wins,
            sum(source_price_nano)::text AS wagered,
            max(target_price_nano) FILTER (WHERE success)::text AS best
       FROM upgrades WHERE user_id = $1`,
    [userId],
  );

  const total = Number(row?.total ?? '0');
  const wins = Number(row?.wins ?? '0');
  return {
    total,
    wins,
    losses: total - wins,
    winRate: total > 0 ? Math.round((wins / total) * 10000) / 100 : 0,
    bestWin: money(toBigInt(row?.best ?? '0')),
    wagered: money(toBigInt(row?.wagered ?? '0')),
  };
}

/**
 * Ротация серверного семени: старое семя раскрывается (и все игры на нём
 * становятся проверяемыми), выдаётся новое с опубликованным хешем.
 */
export async function rotateServerSeed(
  userId: string,
  newClientSeed?: string,
): Promise<{ revealedServerSeed: string; revealedHash: string; newServerSeedHash: string; clientSeed: string }> {
  const { generateServerSeed, hashServerSeed, generateClientSeed } = await import('../lib/fairness');

  return withTransaction(async (client) => {
    const current = await queryOne<UserSeedRow>(
      'SELECT id, server_seed, server_seed_hash, client_seed, nonce FROM users WHERE id = $1 FOR UPDATE',
      [userId],
      client,
    );
    if (!current) throw notFound('Пользователь не найден', 'USER_NOT_FOUND');

    const nextServerSeed = generateServerSeed();
    const nextHash = hashServerSeed(nextServerSeed);
    const clientSeed = (newClientSeed?.trim() || generateClientSeed()).slice(0, 64);

    await query(
      `INSERT INTO server_seeds (user_id, server_seed, server_seed_hash, client_seed, nonce_used)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id, server_seed_hash) DO NOTHING`,
      [userId, current.server_seed, current.server_seed_hash, current.client_seed, current.nonce],
      client,
    );
    await query(
      'UPDATE upgrades SET revealed = TRUE WHERE user_id = $1 AND server_seed_hash = $2',
      [userId, current.server_seed_hash],
      client,
    );
    await query(
      'UPDATE users SET server_seed = $2, server_seed_hash = $3, client_seed = $4, nonce = 0 WHERE id = $1',
      [userId, nextServerSeed, nextHash, clientSeed],
      client,
    );

    return {
      revealedServerSeed: current.server_seed,
      revealedHash: current.server_seed_hash,
      newServerSeedHash: nextHash,
      clientSeed,
    };
  });
}

/** Текущие публичные параметры честности пользователя. */
export async function getFairnessInfo(userId: string): Promise<{
  serverSeedHash: string;
  clientSeed: string;
  nonce: number;
}> {
  const row = await queryOne<{ server_seed_hash: string; client_seed: string; nonce: string }>(
    'SELECT server_seed_hash, client_seed, nonce FROM users WHERE id = $1',
    [userId],
    pool,
  );
  if (!row) throw notFound('Пользователь не найден', 'USER_NOT_FOUND');
  return { serverSeedHash: row.server_seed_hash, clientSeed: row.client_seed, nonce: Number(row.nonce) };
}
