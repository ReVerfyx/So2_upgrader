/** Заявки на вывод предметов. */
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../lib/asyncHandler';
import { parseOrThrow } from '../lib/validate';
import { paged, paginationSchema, uuidSchema } from '../lib/http';
import { requireAuth } from '../middleware/auth';
import { rateLimit } from '../middleware/rateLimit';
import { idempotency } from '../middleware/idempotency';
import {
  cancelWithdrawal,
  createWithdrawal,
  getWithdrawal,
  listUserWithdrawals,
} from '../services/withdrawalService';

export const withdrawRouter = Router();

withdrawRouter.post(
  '/withdraw',
  requireAuth,
  rateLimit({ name: 'withdraw-create', windowMs: 60_000, max: 10 }),
  idempotency('POST /api/withdraw'),
  asyncHandler(async (req, res) => {
    const input = parseOrThrow(
      z.object({
        inventoryId: uuidSchema,
        gameNickname: z.string().min(3).max(64),
        contact: z.string().max(128).optional(),
      }),
      req.body,
    );

    const withdrawal = await createWithdrawal({
      userId: req.user!.id,
      inventoryId: input.inventoryId,
      gameNickname: input.gameNickname,
      contact: input.contact,
    });

    res.status(201).json({
      withdrawal,
      notice:
        'Заявка принята и поставлена в очередь. Выдача предмета выполняется оператором вручную — среднее время обработки указано на странице вывода.',
    });
  }),
);

withdrawRouter.get(
  '/withdrawals',
  requireAuth,
  asyncHandler(async (req, res) => {
    const pagination = parseOrThrow(paginationSchema, req.query);
    const result = await listUserWithdrawals({
      userId: req.user!.id,
      limit: pagination.limit,
      offset: pagination.offset,
    });
    res.json(paged(result.items, result.total, pagination));
  }),
);

withdrawRouter.get(
  '/withdrawals/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = parseOrThrow(uuidSchema, req.params.id);
    res.json({ withdrawal: await getWithdrawal(req.user!.id, id) });
  }),
);

withdrawRouter.post(
  '/withdrawals/:id/cancel',
  requireAuth,
  rateLimit({ name: 'withdraw-cancel', windowMs: 60_000, max: 20 }),
  asyncHandler(async (req, res) => {
    const id = parseOrThrow(uuidSchema, req.params.id);
    res.json({ withdrawal: await cancelWithdrawal(req.user!.id, id) });
  }),
);
