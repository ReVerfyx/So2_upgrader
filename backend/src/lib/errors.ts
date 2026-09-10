/** Прикладные ошибки с машиночитаемым кодом и безопасным текстом для клиента. */

export class AppError extends Error {
  public readonly status: number;
  public readonly code: string;
  public readonly details?: unknown;
  public readonly expose: boolean;

  constructor(message: string, options: { status?: number; code?: string; details?: unknown; expose?: boolean } = {}) {
    super(message);
    this.name = 'AppError';
    this.status = options.status ?? 400;
    this.code = options.code ?? 'BAD_REQUEST';
    this.details = options.details;
    this.expose = options.expose ?? true;
  }
}

export const badRequest = (message: string, code = 'BAD_REQUEST', details?: unknown) =>
  new AppError(message, { status: 400, code, details });

export const unauthorized = (message = 'Требуется авторизация', code = 'UNAUTHORIZED') =>
  new AppError(message, { status: 401, code });

export const forbidden = (message = 'Доступ запрещён', code = 'FORBIDDEN') =>
  new AppError(message, { status: 403, code });

export const notFound = (message = 'Ресурс не найден', code = 'NOT_FOUND') =>
  new AppError(message, { status: 404, code });

export const conflict = (message: string, code = 'CONFLICT') =>
  new AppError(message, { status: 409, code });

export const tooManyRequests = (message = 'Слишком много запросов, попробуйте позже', code = 'RATE_LIMITED') =>
  new AppError(message, { status: 429, code });

export const internal = (message = 'Внутренняя ошибка сервера', code = 'INTERNAL_ERROR') =>
  new AppError(message, { status: 500, code, expose: false });
