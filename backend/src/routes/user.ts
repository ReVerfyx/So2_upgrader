/** Профиль пользователя, баланс, честность (provably fair). */
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../lib/asyncHandler';
import { parseOrThrow, sanitizeText } from '../lib/validate';
import { money } from '../lib/money';
import { requireAuth } from '../middleware/auth';
import { rateLimit } from '../middleware/rateLimit';
import { getBalance, listTransactions } from '../services/balanceService';
import { updateProfile } from '../services/authService';
import { getFairnessInfo, getUserUpgradeStats, rotateServerSeed } from '../services/upgradeService';
import { listInventory } from '../services/inventoryService';
import { paged, paginationSchema } from '../lib/http';

export const userRouter = Router();

userRouter.get(
  '/user',
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = req.user!;
    const [balance, stats, inventory, fairness] = await Promise.all([
      getBalance(user.id),
      getUserUpgradeStats(user.id),
      listInventory({ userId: user.id, limit: 1, offset: 0 }),
      getFairnessInfo(user.id),
    ]);

    res.json({
      user: {
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        email: user.email,
        role: user.role,
        avatarUrl: user.avatarUrl,
        gameNickname: user.gameNickname,
        contact: user.contact,
        createdAt: user.createdAt,
      },
      balance: money(balance.amountMinor),
      locked: money(balance.lockedMinor),
      inventory: { count: inventory.total, value: money(inventory.totalValueMinor) },
      stats,
      fairness,
      csrfToken: req.csrfToken,
    });
  }),
);

userRouter.patch(
  '/user',
  requireAuth,
  rateLimit({ name: 'profile-update', windowMs: 60_000, max: 10 }),
  asyncHandler(async (req, res) => {
    const input = parseOrThrow(
      z.object({
        displayName: z.string().min(2).max(48).optional(),
        gameNickname: z.string().min(3).max(64).optional(),
        contact: z.string().max(128).optional(),
      }),
      req.body,
    );

    const user = await updateProfile(req.user!.id, {
      displayName: input.displayName ? sanitizeText(input.displayName, 48) : undefined,
      gameNickname: input.gameNickname ? sanitizeText(input.gameNickname, 64) : undefined,
      contact: input.contact ? sanitizeText(input.contact, 128) : undefined,
    });

    res.json({
      user: {
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        gameNickname: user.gameNickname,
        contact: user.contact,
        avatarUrl: user.avatarUrl,
        role: user.role,
        email: user.email,
        createdAt: user.createdAt,
      },
    });
  }),
);

userRouter.get(
  '/balance',
  requireAuth,
  asyncHandler(async (req, res) => {
    const balance = await getBalance(req.user!.id);
    res.json({ balance: money(balance.amountMinor), locked: money(balance.lockedMinor), currency: balance.currency });
  }),
);

userRouter.get(
  '/transactions',
  requireAuth,
  asyncHandler(async (req, res) => {
    const pagination = parseOrThrow(paginationSchema, req.query);
    const type = typeof req.query.type === 'string' ? req.query.type : undefined;
    const result = await listTransactions({
      userId: req.user!.id,
      limit: pagination.limit,
      offset: pagination.offset,
      type: type as never,
    });

    res.json(
      paged(
        result.items.map((entry) => ({
          id: entry.id,
          type: entry.type,
          amount: money(entry.amountMinor),
          balanceBefore: money(entry.balanceBeforeMinor),
          balanceAfter: money(entry.balanceAfterMinor),
          status: entry.status,
          referenceType: entry.referenceType,
          referenceId: entry.referenceId,
          txHash: entry.txHash,
          metadata: entry.metadata,
          createdAt: entry.createdAt,
        })),
        result.total,
        pagination,
      ),
    );
  }),
);

/* --------------------------- Provably fair -------------------------------- */

userRouter.get(
  '/user/fairness',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json(await getFairnessInfo(req.user!.id));
  }),
);

userRouter.post(
  '/user/fairness/rotate',
  requireAuth,
  rateLimit({ name: 'seed-rotate', windowMs: 60_000, max: 10 }),
  asyncHandler(async (req, res) => {
    const input = parseOrThrow(
      z.object({ clientSeed: z.string().min(4).max(64).optional() }),
      req.body ?? {},
    );
    const result = await rotateServerSeed(req.user!.id, input.clientSeed);
    res.json({
      ...result,
      message: 'Старое серверное семя раскрыто — теперь все прошлые игры на нём можно перепроверить.',
    });
  }),
);
