/** Инвентарь пользователя. */
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../lib/asyncHandler';
import { parseOrThrow } from '../lib/validate';
import { money } from '../lib/money';
import { paged, paginationSchema, uuidSchema } from '../lib/http';
import { requireAuth } from '../middleware/auth';
import { rateLimit } from '../middleware/rateLimit';
import { getInventoryItem, listInventory, sellInventoryItem } from '../services/inventoryService';
import { getBalance } from '../services/balanceService';

export const inventoryRouter = Router();

inventoryRouter.get(
  '/inventory',
  requireAuth,
  asyncHandler(async (req, res) => {
    const input = parseOrThrow(
      paginationSchema.extend({
        status: z.enum(['available', 'locked', 'withdrawn', 'all']).optional(),
        sort: z.enum(['price_asc', 'price_desc', 'newest']).optional(),
      }),
      req.query,
    );

    const result = await listInventory({
      userId: req.user!.id,
      status: input.status,
      sort: input.sort,
      limit: input.limit,
      offset: input.offset,
    });

    res.json({
      ...paged(result.items, result.total, input),
      totalValue: money(result.totalValueNano),
    });
  }),
);

inventoryRouter.get(
  '/inventory/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = parseOrThrow(uuidSchema, req.params.id);
    res.json({ item: await getInventoryItem(req.user!.id, id) });
  }),
);

inventoryRouter.post(
  '/inventory/:id/sell',
  requireAuth,
  rateLimit({ name: 'inventory-sell', windowMs: 60_000, max: 30 }),
  asyncHandler(async (req, res) => {
    const id = parseOrThrow(uuidSchema, req.params.id);
    const result = await sellInventoryItem(req.user!.id, id);
    const balance = await getBalance(req.user!.id);
    res.json({ sold: money(result.amountNano), balance: money(balance.amountNano) });
  }),
);
