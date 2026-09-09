/**
 * Маршруты тестового режима.
 *
 * Доступны ТОЛЬКО при TEST_MODE=true и NODE_ENV !== production.
 * В production роутер вообще не подключается (см. app.ts), поэтому эти
 * эндпоинты физически отсутствуют на боевом сервере.
 */
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../lib/asyncHandler';
import { parseOrThrow } from '../lib/validate';
import { coinAmountSchema, tonAmountSchema, uuidSchema } from '../lib/http';
import { requireAuth } from '../middleware/auth';
import { rateLimit } from '../middleware/rateLimit';
import { env } from '../config/env';
import { forbidden, notFound } from '../lib/errors';
import { money, nanoToTon } from '../lib/money';
import { withTransaction, queryOne } from '../db/tx';
import { applyBalanceChange, getBalance } from '../services/balanceService';
import { addItemToInventory } from '../services/inventoryService';
import { getMockProvider } from '../ton';
import { runWatcherCycle } from '../workers/depositWatcher';
import { SEED_ITEMS, STARTER_ITEM_SLUGS } from '../db/seedData';
import { logger } from '../lib/logger';

export const devRouter = Router();

// Двойная защита: даже при ошибочном подключении роутер откажет в production.
devRouter.use((req, _res, next) => {
  if (!env.testMode || env.isProduction) {
    next(forbidden('Тестовый режим отключён', 'TEST_MODE_DISABLED'));
    return;
  }
  next();
});

devRouter.use(requireAuth);
devRouter.use(rateLimit({ name: 'dev', windowMs: 60_000, max: 60 }));

/** Начисление тестового баланса. */
devRouter.post(
  '/balance',
  asyncHandler(async (req, res) => {
    const input = parseOrThrow(z.object({ amount: coinAmountSchema }), req.body);
    if (input.amount > 1_000_000n * 100n) {
      res.status(422).json({ error: { code: 'AMOUNT_TOO_LARGE', message: 'Не более 1 000 000 монет за раз' } });
      return;
    }

    await withTransaction(async (client) => {
      await applyBalanceChange(
        {
          userId: req.user!.id,
          amountMinor: input.amount,
          type: 'test_credit',
          referenceType: 'dev',
          metadata: { testMode: true },
        },
        client,
      );
    });

    const balance = await getBalance(req.user!.id);
    logger.warn('Начислен тестовый баланс', { userId: req.user!.id, amount: nanoToTon(input.amount) });
    res.json({ balance: money(balance.amountMinor) });
  }),
);

/** Выдача тестового предмета в инвентарь. */
devRouter.post(
  '/items',
  asyncHandler(async (req, res) => {
    const input = parseOrThrow(
      z.object({ itemId: uuidSchema.optional(), slug: z.string().max(64).optional() }),
      req.body ?? {},
    );

    const item = await queryOne<{ id: string; price_minor: string; condition: string; name: string }>(
      input.itemId
        ? 'SELECT id, price_minor, condition, name FROM items WHERE id = $1'
        : 'SELECT id, price_minor, condition, name FROM items WHERE slug = $1',
      [input.itemId ?? input.slug ?? STARTER_ITEM_SLUGS[0]],
    );
    if (!item) throw notFound('Предмет не найден', 'ITEM_NOT_FOUND');

    const inventoryId = await withTransaction((client) =>
      addItemToInventory(
        {
          userId: req.user!.id,
          itemId: item.id,
          priceMinor: BigInt(item.price_minor),
          condition: item.condition as never,
          acquiredFrom: 'test',
        },
        client,
      ),
    );

    res.status(201).json({ inventoryId, itemName: item.name });
  }),
);

/** Выдача стартового набора предметов. */
devRouter.post(
  '/starter-pack',
  asyncHandler(async (req, res) => {
    const created: string[] = [];
    await withTransaction(async (client) => {
      for (const slug of STARTER_ITEM_SLUGS) {
        const item = await queryOne<{ id: string; price_minor: string; condition: string }>(
          'SELECT id, price_minor, condition FROM items WHERE slug = $1',
          [slug],
          client,
        );
        if (!item) continue;
        const id = await addItemToInventory(
          {
            userId: req.user!.id,
            itemId: item.id,
            priceMinor: BigInt(item.price_minor),
            condition: item.condition as never,
            acquiredFrom: 'test',
          },
          client,
        );
        created.push(id);
      }
    });
    res.status(201).json({ created: created.length, inventoryIds: created });
  }),
);

/**
 * Имитация входящего платежа TON.
 * Транзакция кладётся в mock-провайдер и проходит ровно тот же путь
 * проверки и зачисления, что и настоящая: воркер → creditTransaction.
 */
devRouter.post(
  '/ton/simulate-payment',
  asyncHandler(async (req, res) => {
    const input = parseOrThrow(
      z.object({ paymentId: z.string().min(4).max(32), amountTon: tonAmountSchema.optional() }),
      req.body,
    );

    const provider = getMockProvider();
    if (!provider) {
      res.status(409).json({
        error: {
          code: 'MOCK_PROVIDER_REQUIRED',
          message: 'Имитация платежа доступна только при TON_PROVIDER=mock',
        },
      });
      return;
    }

    const deposit = await queryOne<{ id: string; user_id: string; amount_nano: string; wallet_address: string }>(
      'SELECT id, user_id, amount_nano, wallet_address FROM deposits WHERE payment_id = $1',
      [input.paymentId.toUpperCase()],
    );
    if (!deposit) throw notFound('Счёт не найден', 'DEPOSIT_NOT_FOUND');
    if (deposit.user_id !== req.user!.id) throw forbidden('Счёт другого пользователя', 'NOT_DEPOSIT_OWNER');

    const tx = provider.pushTransaction({
      amountNano: input.amountTon ?? BigInt(deposit.amount_nano),
      comment: input.paymentId.toUpperCase(),
      destination: deposit.wallet_address,
    });

    const stats = await runWatcherCycle();
    res.json({ transactionHash: tx.hash, stats });
  }),
);

/** Справочник демонстрационных предметов (для быстрой отладки). */
devRouter.get(
  '/catalog',
  asyncHandler(async (_req, res) => {
    res.json({ items: SEED_ITEMS.map((item) => ({ slug: item.slug, name: item.name, priceCoins: item.priceCoins })) });
  }),
);
