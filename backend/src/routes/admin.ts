/**
 * Админ-панель (защищённая часть API).
 *
 * Доступ разрешён только пользователям с role = 'admin'.
 * Пароль администратора нигде во фронтенде не хранится: вход выполняется
 * той же формой, что и обычный вход, а права проверяются на сервере.
 * Каждое действие пишется в admin_logs.
 */
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../lib/asyncHandler';
import { parseOrThrow } from '../lib/validate';
import { coinAmountSchema, paged, paginationSchema, tonAmountSchema, uuidSchema } from '../lib/http';
import { requireAdmin } from '../middleware/auth';
import { rateLimit } from '../middleware/rateLimit';
import { money } from '../lib/money';
import { badRequest } from '../lib/errors';
import {
  adjustBalance,
  getAdminStats,
  getUserDetails,
  grantItem,
  listAdminLogs,
  listAllDeposits,
  listAllUpgrades,
  listErrorLogs,
  listUsers,
  logAdminAction,
  revokeInventoryItem,
  setUserBlocked,
} from '../services/adminService';
import {
  completeWithdrawal,
  listAllWithdrawals,
  rejectWithdrawal,
  takeWithdrawal,
} from '../services/withdrawalService';
import { createItem, listItems, updateItem } from '../services/itemService';
import { adminConfirmDeposit } from '../services/depositService';
import { getAllSettings, getRateSettings, updateSetting } from '../services/settingsService';
import { getRateInfo, refreshRate } from '../services/rateService';
import { runWatcherCycle } from '../workers/depositWatcher';

export const adminRouter = Router();

adminRouter.use(requireAdmin);
adminRouter.use(rateLimit({ name: 'admin', windowMs: 60_000, max: 300 }));

/* --------------------------------- Сводка -------------------------------- */

adminRouter.get(
  '/stats',
  asyncHandler(async (_req, res) => {
    res.json({ stats: await getAdminStats() });
  }),
);

/* ------------------------------ Пользователи ----------------------------- */

adminRouter.get(
  '/users',
  asyncHandler(async (req, res) => {
    const input = parseOrThrow(
      paginationSchema.extend({
        search: z.string().max(64).optional(),
        blocked: z.enum(['true', 'false']).optional(),
      }),
      req.query,
    );
    const result = await listUsers({
      search: input.search,
      blocked: input.blocked === undefined ? undefined : input.blocked === 'true',
      limit: input.limit,
      offset: input.offset,
    });
    res.json(paged(result.items, result.total, input));
  }),
);

adminRouter.get(
  '/users/:id',
  asyncHandler(async (req, res) => {
    const id = parseOrThrow(uuidSchema, req.params.id);
    res.json({ user: await getUserDetails(id) });
  }),
);

adminRouter.post(
  '/users/:id/block',
  asyncHandler(async (req, res) => {
    const id = parseOrThrow(uuidSchema, req.params.id);
    const input = parseOrThrow(
      z.object({ blocked: z.boolean(), reason: z.string().max(300).optional() }),
      req.body,
    );
    const user = await setUserBlocked({ userId: id, blocked: input.blocked, reason: input.reason });
    await logAdminAction({
      adminId: req.user!.id,
      action: input.blocked ? 'user.block' : 'user.unblock',
      targetType: 'user',
      targetId: id,
      payload: { reason: input.reason ?? null },
      ip: req.ip,
    });
    res.json({ user });
  }),
);

adminRouter.post(
  '/users/:id/balance',
  asyncHandler(async (req, res) => {
    const id = parseOrThrow(uuidSchema, req.params.id);
    const input = parseOrThrow(
      z.object({
        amount: coinAmountSchema,
        direction: z.enum(['credit', 'debit']),
        reason: z.string().min(3).max(300),
      }),
      req.body,
    );

    const signed = input.direction === 'credit' ? input.amount : -input.amount;
    const result = await adjustBalance({
      userId: id,
      amountMinor: signed,
      reason: input.reason,
      adminId: req.user!.id,
    });

    await logAdminAction({
      adminId: req.user!.id,
      action: 'balance.adjust',
      targetType: 'user',
      targetId: id,
      payload: { amountMinor: signed.toString(), reason: input.reason, transactionId: result.transactionId },
      ip: req.ip,
    });

    res.json(result);
  }),
);

adminRouter.post(
  '/users/:id/grant-item',
  asyncHandler(async (req, res) => {
    const id = parseOrThrow(uuidSchema, req.params.id);
    const input = parseOrThrow(z.object({ itemId: uuidSchema }), req.body);
    const result = await grantItem({ userId: id, itemId: input.itemId, adminId: req.user!.id });
    await logAdminAction({
      adminId: req.user!.id,
      action: 'inventory.grant',
      targetType: 'user',
      targetId: id,
      payload: { itemId: input.itemId, inventoryId: result.inventoryId },
      ip: req.ip,
    });
    res.status(201).json(result);
  }),
);

adminRouter.delete(
  '/inventory/:id',
  asyncHandler(async (req, res) => {
    const id = parseOrThrow(uuidSchema, req.params.id);
    await revokeInventoryItem(id);
    await logAdminAction({
      adminId: req.user!.id,
      action: 'inventory.revoke',
      targetType: 'inventory',
      targetId: id,
      ip: req.ip,
    });
    res.json({ ok: true });
  }),
);

/* -------------------------------- Выводы --------------------------------- */

adminRouter.get(
  '/withdrawals',
  asyncHandler(async (req, res) => {
    const input = parseOrThrow(
      paginationSchema.extend({
        status: z.enum(['pending', 'processing', 'completed', 'rejected']).optional(),
        search: z.string().max(64).optional(),
      }),
      req.query,
    );
    const result = await listAllWithdrawals({
      status: input.status,
      search: input.search,
      limit: input.limit,
      offset: input.offset,
    });
    res.json(paged(result.items, result.total, input));
  }),
);

adminRouter.post(
  '/withdrawals/:id/take',
  asyncHandler(async (req, res) => {
    const id = parseOrThrow(uuidSchema, req.params.id);
    const withdrawal = await takeWithdrawal(id, req.user!.id);
    await logAdminAction({
      adminId: req.user!.id,
      action: 'withdrawal.take',
      targetType: 'withdrawal',
      targetId: id,
      ip: req.ip,
    });
    res.json({ withdrawal });
  }),
);

adminRouter.post(
  '/withdrawals/:id/process',
  asyncHandler(async (req, res) => {
    const id = parseOrThrow(uuidSchema, req.params.id);
    const input = parseOrThrow(
      z.object({ txHash: z.string().max(128).optional(), comment: z.string().max(500).optional() }),
      req.body ?? {},
    );
    const withdrawal = await completeWithdrawal({
      id,
      adminId: req.user!.id,
      txHash: input.txHash,
      comment: input.comment,
    });
    await logAdminAction({
      adminId: req.user!.id,
      action: 'withdrawal.complete',
      targetType: 'withdrawal',
      targetId: id,
      payload: { txHash: input.txHash ?? null, comment: input.comment ?? null },
      ip: req.ip,
    });
    res.json({ withdrawal });
  }),
);

adminRouter.post(
  '/withdrawals/:id/reject',
  asyncHandler(async (req, res) => {
    const id = parseOrThrow(uuidSchema, req.params.id);
    const input = parseOrThrow(z.object({ comment: z.string().min(3).max(500) }), req.body);
    const withdrawal = await rejectWithdrawal({ id, adminId: req.user!.id, comment: input.comment });
    await logAdminAction({
      adminId: req.user!.id,
      action: 'withdrawal.reject',
      targetType: 'withdrawal',
      targetId: id,
      payload: { comment: input.comment },
      ip: req.ip,
    });
    res.json({ withdrawal });
  }),
);

/* ------------------------------ Пополнения ------------------------------- */

adminRouter.get(
  '/deposits',
  asyncHandler(async (req, res) => {
    const input = parseOrThrow(
      paginationSchema.extend({ status: z.enum(['pending', 'confirmed', 'failed', 'expired']).optional() }),
      req.query,
    );
    const result = await listAllDeposits({ status: input.status, limit: input.limit, offset: input.offset });
    res.json(paged(result.items, result.total, input));
  }),
);

adminRouter.post(
  '/deposits/:id/confirm',
  asyncHandler(async (req, res) => {
    const id = parseOrThrow(uuidSchema, req.params.id);
    const input = parseOrThrow(
      z.object({
        txHash: z.string().min(4).max(128),
        amountTon: tonAmountSchema.optional(),
        comment: z.string().max(300).optional(),
      }),
      req.body,
    );
    const deposit = await adminConfirmDeposit({
      depositId: id,
      adminId: req.user!.id,
      txHash: input.txHash,
      amountNano: input.amountTon,
      comment: input.comment,
    });
    await logAdminAction({
      adminId: req.user!.id,
      action: 'deposit.manual_confirm',
      targetType: 'deposit',
      targetId: id,
      payload: { txHash: input.txHash },
      ip: req.ip,
    });
    res.json({ deposit });
  }),
);

/** Принудительный запуск проверки блокчейна. */
adminRouter.post(
  '/deposits/check',
  rateLimit({ name: 'admin-watcher', windowMs: 60_000, max: 10 }),
  asyncHandler(async (req, res) => {
    const stats = await runWatcherCycle();
    await logAdminAction({ adminId: req.user!.id, action: 'deposit.manual_check', payload: { ...stats }, ip: req.ip });
    res.json({ stats });
  }),
);

/* -------------------------------- Предметы ------------------------------- */

const itemInputSchema = z.object({
  slug: z.string().min(2).max(64).regex(/^[a-z0-9-]+$/, 'Только строчные латинские буквы, цифры и дефис'),
  name: z.string().min(2).max(120),
  weapon: z.string().min(1).max(48),
  rarity: z.enum(['common', 'rare', 'epic', 'legendary', 'arcane', 'contraband']),
  condition: z.enum(['factory_new', 'minimal_wear', 'field_tested', 'well_worn', 'battle_scarred']),
  imageUrl: z.string().min(1).max(500),
  price: coinAmountSchema,
  isActive: z.boolean().default(true),
  isWithdrawable: z.boolean().default(true),
  description: z.string().max(500).optional(),
});

adminRouter.get(
  '/items',
  asyncHandler(async (req, res) => {
    const input = parseOrThrow(paginationSchema.extend({ search: z.string().max(64).optional() }), req.query);
    const result = await listItems({
      search: input.search,
      limit: input.limit,
      offset: input.offset,
      includeInactive: true,
      sort: 'price_desc',
    });
    res.json(paged(result.items, result.total, input));
  }),
);

adminRouter.post(
  '/items',
  asyncHandler(async (req, res) => {
    const input = parseOrThrow(itemInputSchema, req.body);
    const item = await createItem({
      slug: input.slug,
      name: input.name,
      weapon: input.weapon,
      rarity: input.rarity,
      condition: input.condition,
      imageUrl: input.imageUrl,
      priceMinor: input.price,
      isActive: input.isActive,
      isWithdrawable: input.isWithdrawable,
      description: input.description ?? null,
    });
    await logAdminAction({
      adminId: req.user!.id,
      action: 'item.create',
      targetType: 'item',
      targetId: item.id,
      payload: { slug: input.slug, priceMinor: input.price.toString() },
      ip: req.ip,
    });
    res.status(201).json({ item });
  }),
);

adminRouter.patch(
  '/items/:id',
  asyncHandler(async (req, res) => {
    const id = parseOrThrow(uuidSchema, req.params.id);
    const input = parseOrThrow(itemInputSchema.partial().omit({ slug: true }), req.body);
    const item = await updateItem(id, {
      name: input.name,
      weapon: input.weapon,
      rarity: input.rarity,
      condition: input.condition,
      imageUrl: input.imageUrl,
      priceMinor: input.price,
      isActive: input.isActive,
      isWithdrawable: input.isWithdrawable,
      description: input.description,
    });
    await logAdminAction({
      adminId: req.user!.id,
      action: 'item.update',
      targetType: 'item',
      targetId: id,
      payload: { ...input, price: input.price?.toString() },
      ip: req.ip,
    });
    res.json({ item });
  }),
);

/* ------------------------------ Коэффициенты ----------------------------- */

adminRouter.get(
  '/settings',
  asyncHandler(async (_req, res) => {
    res.json({ settings: await getAllSettings() });
  }),
);

adminRouter.put(
  '/settings/upgrade',
  asyncHandler(async (req, res) => {
    const input = parseOrThrow(
      z.object({
        houseEdge: z.number().min(0).max(0.5),
        minChance: z.number().min(0.0001).max(0.5),
        maxChance: z.number().min(0.05).max(0.95),
        maxMultiplier: z.number().min(1.1).max(1000),
        minStake: coinAmountSchema,
      }),
      req.body,
    );
    if (input.minChance >= input.maxChance) {
      res.status(422).json({
        error: { code: 'INVALID_RANGE', message: 'Минимальный шанс должен быть меньше максимального' },
      });
      return;
    }

    await updateSetting(
      'upgrade',
      {
        houseEdge: input.houseEdge,
        minChance: input.minChance,
        maxChance: input.maxChance,
        maxMultiplier: input.maxMultiplier,
        minStakeMinor: input.minStake.toString(),
      },
      req.user!.id,
    );
    await logAdminAction({
      adminId: req.user!.id,
      action: 'settings.upgrade',
      targetType: 'settings',
      targetId: 'upgrade',
      payload: { ...input, minStake: input.minStake.toString() },
      ip: req.ip,
    });
    res.json({ ok: true, settings: await getAllSettings() });
  }),
);

adminRouter.put(
  '/settings/deposit',
  asyncHandler(async (req, res) => {
    const input = parseOrThrow(
      z.object({
        minDepositTon: tonAmountSchema,
        ttlMinutes: z.number().int().min(5).max(720),
        minConfirmations: z.number().int().min(1).max(30),
      }),
      req.body,
    );
    await updateSetting(
      'deposit',
      {
        minDepositNano: input.minDepositTon.toString(),
        ttlMinutes: input.ttlMinutes,
        minConfirmations: input.minConfirmations,
      },
      req.user!.id,
    );
    await logAdminAction({
      adminId: req.user!.id,
      action: 'settings.deposit',
      targetType: 'settings',
      targetId: 'deposit',
      payload: { ...input, minDepositTon: input.minDepositTon.toString() },
      ip: req.ip,
    });
    res.json({ ok: true, settings: await getAllSettings() });
  }),
);

/**
 * Курс обмена TON → монеты (1 монета = 1 рубль).
 *
 * auto = true  — курс берётся с биржевых источников и обновляется сам,
 *                администратор задаёт только спред площадки;
 * auto = false — действует курс, введённый вручную.
 */
adminRouter.put(
  '/settings/rates',
  asyncHandler(async (req, res) => {
    const input = parseOrThrow(
      z.object({
        auto: z.boolean(),
        spreadPercent: z.number().min(0).max(50).default(0),
        maxAgeMinutes: z.number().int().min(0).max(10_080).optional(),
        coinsPerTon: z.number().min(1).max(1_000_000).optional(),
      }),
      req.body,
    );

    if (!input.auto && input.coinsPerTon === undefined) {
      throw badRequest('В ручном режиме нужно указать курс', 'MANUAL_RATE_REQUIRED');
    }

    const current = await getRateSettings();
    const minorPerTon =
      input.coinsPerTon !== undefined ? BigInt(Math.round(input.coinsPerTon * 100)) : current.minorPerTon;

    await updateSetting(
      'rates',
      {
        minorPerTon: minorPerTon.toString(),
        marketRubPerTon: current.marketRubPerTon,
        spreadPercent: input.spreadPercent,
        auto: input.auto,
        maxAgeMinutes: input.maxAgeMinutes ?? current.maxAgeMinutes,
        source: input.auto ? current.source : 'manual',
        updatedAt: new Date().toISOString(),
      },
      req.user!.id,
    );

    // В автоматическом режиме сразу подтягиваем свежий курс с новым спредом.
    const refreshed = input.auto ? await refreshRate({ force: true, adminId: req.user!.id }) : null;

    await logAdminAction({
      adminId: req.user!.id,
      action: 'settings.rates',
      targetType: 'settings',
      targetId: 'rates',
      payload: { ...input, refreshed: refreshed?.updated ?? false },
      ip: req.ip,
    });

    res.json({ ok: true, rate: await getRateInfo(), refreshFailures: refreshed?.failures ?? [] });
  }),
);

/** Принудительное обновление курса с биржевых источников. */
adminRouter.post(
  '/settings/rates/refresh',
  rateLimit({ name: 'admin-rate-refresh', windowMs: 60_000, max: 10 }),
  asyncHandler(async (req, res) => {
    const result = await refreshRate({ force: true, adminId: req.user!.id });
    await logAdminAction({
      adminId: req.user!.id,
      action: 'settings.rates.refresh',
      payload: { updated: result.updated, source: result.source, failures: result.failures },
      ip: req.ip,
    });

    res.json({
      updated: result.updated,
      rate: await getRateInfo(),
      failures: result.failures,
      message: result.updated
        ? `Курс обновлён из источника «${result.source}»`
        : 'Ни один источник не ответил, действует прежний курс',
    });
  }),
);

/** Текущее состояние курса. */
adminRouter.get(
  '/settings/rates',
  asyncHandler(async (_req, res) => {
    res.json({ rate: await getRateInfo() });
  }),
);

adminRouter.put(
  '/settings/site',
  asyncHandler(async (req, res) => {
    const input = parseOrThrow(
      z.object({ maintenance: z.boolean(), announcement: z.string().max(300) }),
      req.body,
    );
    await updateSetting('site', input, req.user!.id);
    await logAdminAction({
      adminId: req.user!.id,
      action: 'settings.site',
      targetType: 'settings',
      targetId: 'site',
      payload: input,
      ip: req.ip,
    });
    res.json({ ok: true });
  }),
);

/* -------------------------------- Журналы -------------------------------- */

adminRouter.get(
  '/upgrades',
  asyncHandler(async (req, res) => {
    const input = parseOrThrow(
      paginationSchema.extend({ userId: uuidSchema.optional(), onlyWins: z.enum(['true', 'false']).optional() }),
      req.query,
    );
    const result = await listAllUpgrades({
      limit: input.limit,
      offset: input.offset,
      userId: input.userId,
      onlyWins: input.onlyWins === 'true',
    });
    res.json(paged(result.items, result.total, input));
  }),
);

adminRouter.get(
  '/logs',
  asyncHandler(async (req, res) => {
    const input = parseOrThrow(paginationSchema.extend({ action: z.string().max(64).optional() }), req.query);
    const result = await listAdminLogs({ limit: input.limit, offset: input.offset, action: input.action });
    res.json(paged(result.items, result.total, input));
  }),
);

adminRouter.get(
  '/errors',
  asyncHandler(async (req, res) => {
    const input = parseOrThrow(
      paginationSchema.extend({ level: z.enum(['warn', 'error', 'fatal']).optional() }),
      req.query,
    );
    const result = await listErrorLogs({ limit: input.limit, offset: input.offset, level: input.level });
    res.json(paged(result.items, result.total, input));
  }),
);

/* ----------------------------- Служебное --------------------------------- */

adminRouter.get(
  '/me',
  asyncHandler(async (req, res) => {
    res.json({
      admin: { id: req.user!.id, username: req.user!.username, displayName: req.user!.displayName },
      balanceHint: money(0n),
    });
  }),
);
