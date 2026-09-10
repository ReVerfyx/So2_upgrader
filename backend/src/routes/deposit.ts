/** Пополнение баланса через TON. */
import { Router } from 'express';
import { asyncHandler } from '../lib/asyncHandler';
import { parseOrThrow } from '../lib/validate';
import { paged, paginationSchema, tonAmountSchema, uuidSchema } from '../lib/http';
import { requireAuth } from '../middleware/auth';
import { rateLimit } from '../middleware/rateLimit';
import { idempotency } from '../middleware/idempotency';
import { z } from 'zod';
import { createDeposit, getDeposit, getWalletAddress, listDeposits } from '../services/depositService';
import { getDepositSettings } from '../services/settingsService';
import { getRateInfo } from '../services/rateService';
import { money, nanoToMinor, tonMoney } from '../lib/money';
import { env } from '../config/env';

export const depositRouter = Router();

depositRouter.get(
  '/deposit/info',
  asyncHandler(async (_req, res) => {
    const [settings, rateInfo] = await Promise.all([getDepositSettings(), getRateInfo()]);
    const minorPerTon = BigInt(Math.round(Number(rateInfo.coinsPerTon) * 100));
    res.json({
      minDeposit: tonMoney(settings.minDepositNano),
      minDepositCoins: money(nanoToMinor(settings.minDepositNano, minorPerTon)),
      coinsPerTon: rateInfo.coinsPerTon,
      rate: rateInfo,
      ttlMinutes: settings.ttlMinutes,
      minConfirmations: settings.minConfirmations,
      payCurrency: 'TON',
      balanceCurrency: 'COIN',
      configured: Boolean(env.ton.walletAddress),
      // Адрес отдаём только вместе со счётом, но для страницы «как пополнить»
      // достаточно факта настройки кошелька.
    });
  }),
);

depositRouter.post(
  '/deposit',
  requireAuth,
  rateLimit({ name: 'deposit-create', windowMs: 60_000, max: 10 }),
  idempotency('POST /api/deposit'),
  asyncHandler(async (req, res) => {
    const input = parseOrThrow(z.object({ amount: tonAmountSchema }), req.body);
    const deposit = await createDeposit({ userId: req.user!.id, amountNano: input.amount });
    res.status(201).json({ deposit });
  }),
);

depositRouter.get(
  '/deposits',
  requireAuth,
  asyncHandler(async (req, res) => {
    const pagination = parseOrThrow(paginationSchema, req.query);
    const result = await listDeposits({
      userId: req.user!.id,
      limit: pagination.limit,
      offset: pagination.offset,
    });
    res.json(paged(result.items, result.total, pagination));
  }),
);

depositRouter.get(
  '/deposit/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = parseOrThrow(uuidSchema, req.params.id);
    const deposit = await getDeposit(req.user!.id, id);
    res.json({ deposit, walletAddress: getWalletAddress() });
  }),
);
