/** Валидация входных данных через zod + базовая нормализация строк. */
import type { TypeOf, ZodTypeAny } from 'zod';
import { AppError } from './errors';

/** Регулярное выражение управляющих символов (собирается без литералов). */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = new RegExp('[\\u0000-\\u001F\\u007F]', 'g');

export function parseOrThrow<S extends ZodTypeAny>(
  schema: S,
  data: unknown,
  message = 'Некорректные данные запроса',
): TypeOf<S> {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new AppError(message, {
      status: 422,
      code: 'VALIDATION_ERROR',
      details: result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    });
  }
  return result.data;
}

/** Удаляет HTML-теги и управляющие символы из пользовательской строки. */
export function sanitizeText(value: string, maxLength = 500): string {
  return value
    .replace(/<[^>]*>/g, '')
    .replace(CONTROL_CHARS, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}
