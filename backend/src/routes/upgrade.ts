/**
 * Маршруты апгрейда.
 *
 * Клиент передаёт только ЧТО он хочет апнуть и во что. Стоимость, шанс,
 * бросок и результат вычисляет сервер. Поле expectedChancePpm — это шанс,
 * который был показан пользователю: если он разошёлся с серверным
 * (например, администратор поменял цену предмета), игра не состоится.
 */
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../lib/asyncHandler';
import { parseOrThrow } from '../lib/validate';
import { paged, paginationSchema, coinAmountSchema, uuidSchema } from '../lib/http';
import { requireAuth } from '../middleware/auth';
import { rateLimit } from '../middleware/rateLimit';
import { idempotency } from '../middleware/idempotency';
import {
  getUpgrade,
  listRecentWins,
  listTargets,
  listUserUpgrades,
  performUpgrade,
  previewUpgrade,
} from '../services/upgradeService';
import { getUpgradeSettings } from '../services/settingsService';
import { queryOne } from '../db/tx';
import { toBigInt, money } from '../lib/money';
import { badRequest, notFound } from '../lib/errors';
import { verifyRoll } from '../lib/fairness';

export const upgradeRouter = Router();

const sourceSchema = z
  .object({
    sourceType: z.enum(['item', 'balance']),
    sourceInventoryId: uuidSchema.optional(),
    stake: coinAmountSchema.optional(),
    targetItemId: uuidSchema,
    expectedChancePpm: z.coerce.number().int().min(1).max(999_999).optional(),
  })
  .refine((data) => (data.sourceType === 'item' ? Boolean(data.sourceInventoryId) : data.stake !== undefined), {
    message: 'Для апгрейда предметом нужен sourceInventoryId, для апгрейда балансом — stake',
  });

upgradeRouter.post(
  '/upgrade/preview',
  requireAuth,
  rateLimit({ name: 'upgrade-preview', windowMs: 60_000, max: 120 }),
  asyncHandler(async (req, res) => {
    const input = parseOrThrow(sourceSchema, req.body);
    const quote = await previewUpgrade({
      userId: req.user!.id,
      sourceType: input.sourceType,
      sourceInventoryId: input.sourceInventoryId,
      stakeMinor: input.stake,
      targetItemId: input.targetItemId,
    });
    res.json({ quote });
  }),
);

upgradeRouter.post(
  '/upgrade',
  requireAuth,
  rateLimit({ name: 'upgrade', windowMs: 60_000, max: 30, message: 'Слишком много апгрейдов подряд. Сделайте паузу.' }),
  idempotency('POST /api/upgrade'),
  asyncHandler(async (req, res) => {
    const input = parseOrThrow(sourceSchema, req.body);
    const result = await performUpgrade({
      userId: req.user!.id,
      sourceType: input.sourceType,
      sourceInventoryId: input.sourceInventoryId,
      stakeMinor: input.stake,
      targetItemId: input.targetItemId,
      expectedChancePpm: input.expectedChancePpm,
    });
    res.json({ result });
  }),
);

/** Предметы, доступные как цель для выбранной ставки. */
upgradeRouter.get(
  '/upgrade/targets',
  requireAuth,
  asyncHandler(async (req, res) => {
    const input = parseOrThrow(
      paginationSchema.extend({
        sourceInventoryId: uuidSchema.optional(),
        stake: coinAmountSchema.optional(),
        search: z.string().max(64).optional(),
      }),
      req.query,
    );

    let sourcePriceMinor: bigint;
    if (input.sourceInventoryId) {
      const row = await queryOne<{ user_id: string; price_minor: string }>(
        `SELECT inv.user_id, i.price_minor
           FROM inventory inv JOIN items i ON i.id = inv.item_id
          WHERE inv.id = $1 AND inv.status = 'available'`,
        [input.sourceInventoryId],
      );
      if (!row || row.user_id !== req.user!.id) throw notFound('Предмет не найден', 'INVENTORY_ITEM_NOT_FOUND');
      sourcePriceMinor = toBigInt(row.price_minor);
    } else if (input.stake !== undefined) {
      sourcePriceMinor = input.stake;
    } else {
      throw badRequest('Укажите sourceInventoryId или stake', 'SOURCE_REQUIRED');
    }

    const result = await listTargets({
      sourcePriceMinor,
      search: input.search,
      limit: input.limit,
      offset: input.offset,
    });

    res.json({ ...paged(result.items, result.total, input), sourcePrice: money(sourcePriceMinor) });
  }),
);

upgradeRouter.get(
  '/upgrades',
  requireAuth,
  asyncHandler(async (req, res) => {
    const pagination = parseOrThrow(paginationSchema, req.query);
    const result = await listUserUpgrades({
      userId: req.user!.id,
      limit: pagination.limit,
      offset: pagination.offset,
    });
    res.json(paged(result.items, result.total, pagination));
  }),
);

/** Публичная лента последних выигрышей — видна и без авторизации. */
upgradeRouter.get(
  '/upgrades/recent',
  asyncHandler(async (req, res) => {
    const limit = Math.min(Number(req.query.limit ?? 20) || 20, 50);
    res.json({ items: await listRecentWins(limit) });
  }),
);

upgradeRouter.get(
  '/upgrades/settings',
  asyncHandler(async (_req, res) => {
    const settings = await getUpgradeSettings();
    res.json({
      houseEdgePercent: Math.round(settings.houseEdge * 10000) / 100,
      minChancePercent: Math.round(settings.minChance * 10000) / 100,
      maxChancePercent: Math.round(settings.maxChance * 10000) / 100,
      maxMultiplier: settings.maxMultiplier,
      minStake: money(settings.minStakeMinor),
    });
  }),
);

upgradeRouter.get(
  '/upgrades/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = parseOrThrow(uuidSchema, req.params.id);
    res.json({ upgrade: await getUpgrade(req.user!.id, id) });
  }),
);

/**
 * Проверка честности игры.
 * Доступна после ротации серверного семени — тогда семя раскрыто,
 * и пересчёт можно повторить самостоятельно любым HMAC-калькулятором.
 */
upgradeRouter.get(
  '/upgrades/:id/verify',
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = parseOrThrow(uuidSchema, req.params.id);
    const upgrade = await getUpgrade(req.user!.id, id);

    if (!upgrade.fairness.serverSeed) {
      res.json({
        verifiable: false,
        message:
          'Серверное семя ещё используется. Смените его в профиле («Сменить семя») — после этого игру можно будет проверить.',
        fairness: upgrade.fairness,
      });
      return;
    }

    const verification = verifyRoll({
      serverSeed: upgrade.fairness.serverSeed,
      serverSeedHash: upgrade.fairness.serverSeedHash,
      clientSeed: upgrade.fairness.clientSeed,
      nonce: upgrade.fairness.nonce,
      chancePpm: Math.round(upgrade.chancePercent * 10_000),
      rollPpm: Math.round(upgrade.rollPercent * 10_000),
      success: upgrade.success,
    });

    res.json({
      verifiable: true,
      verification,
      fairness: upgrade.fairness,
      formula: 'HMAC_SHA256(server_seed, `${client_seed}:${nonce}:${round}`) → первые 8 байт → % 1 000 000',
    });
  }),
);
