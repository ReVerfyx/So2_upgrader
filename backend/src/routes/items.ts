/** Публичный каталог предметов. */
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../lib/asyncHandler';
import { parseOrThrow } from '../lib/validate';
import { paged, paginationSchema, tonAmountSchema, uuidSchema } from '../lib/http';
import { getItem, listItems, listWeapons } from '../services/itemService';

export const itemsRouter = Router();

const filtersSchema = paginationSchema.extend({
  search: z.string().max(64).optional(),
  rarity: z.enum(['common', 'rare', 'epic', 'legendary', 'arcane', 'contraband']).optional(),
  weapon: z.string().max(48).optional(),
  minPrice: tonAmountSchema.optional(),
  maxPrice: tonAmountSchema.optional(),
  sort: z.enum(['price_asc', 'price_desc', 'name_asc', 'newest']).optional(),
});

itemsRouter.get(
  '/items',
  asyncHandler(async (req, res) => {
    const input = parseOrThrow(filtersSchema, req.query);
    const result = await listItems({
      search: input.search,
      rarity: input.rarity,
      weapon: input.weapon,
      minPriceNano: input.minPrice,
      maxPriceNano: input.maxPrice,
      sort: input.sort,
      limit: input.limit,
      offset: input.offset,
    });
    res.json(paged(result.items, result.total, input));
  }),
);

itemsRouter.get(
  '/items/weapons',
  asyncHandler(async (_req, res) => {
    res.json({ weapons: await listWeapons() });
  }),
);

itemsRouter.get(
  '/items/:id',
  asyncHandler(async (req, res) => {
    const id = parseOrThrow(uuidSchema, req.params.id);
    res.json({ item: await getItem(id) });
  }),
);
