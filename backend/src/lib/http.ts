/** Общие помощники для маршрутов: пагинация и единый формат ответа. */
import { z } from 'zod';

export const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(24),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
});

export type Pagination = z.infer<typeof paginationSchema>;

export interface PagedResponse<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

export function paged<T>(items: T[], total: number, pagination: Pagination): PagedResponse<T> {
  return {
    items,
    total,
    limit: pagination.limit,
    offset: pagination.offset,
    hasMore: pagination.offset + items.length < total,
  };
}

/** Сумма в монетах из строки запроса → копейки. */
export const coinAmountSchema = z
  .union([z.string(), z.number()])
  .transform((value, ctx) => {
    const raw = typeof value === 'number' ? value.toFixed(2) : value.trim().replace(',', '.');
    if (!/^\d+(\.\d{1,2})?$/.test(raw)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Некорректная сумма' });
      return z.NEVER;
    }
    const [whole = '0', fraction = ''] = raw.split('.');
    return BigInt(whole) * 100n + BigInt((fraction + '00').slice(0, 2));
  });

/** Сумма в TON из строки запроса → нанотоны. */
export const tonAmountSchema = z
  .union([z.string(), z.number()])
  .transform((value, ctx) => {
    const raw = typeof value === 'number' ? value.toFixed(9) : value.trim().replace(',', '.');
    if (!/^\d+(\.\d{1,9})?$/.test(raw)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Некорректная сумма' });
      return z.NEVER;
    }
    const [whole = '0', fraction = ''] = raw.split('.');
    return BigInt(whole) * 1_000_000_000n + BigInt((fraction + '000000000').slice(0, 9));
  });

export const uuidSchema = z.string().uuid('Некорректный идентификатор');
