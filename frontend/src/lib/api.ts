/**
 * Клиент REST API.
 *
 * Особенности:
 *  - сессия передаётся httpOnly cookie (credentials: 'include');
 *  - для изменяющих запросов автоматически подставляется CSRF-токен
 *    из обычной cookie so2_csrf;
 *  - ошибки приводятся к типу ApiError с машиночитаемым кодом.
 */

export class ApiError extends Error {
  public readonly code: string;
  public readonly status: number;
  public readonly details?: unknown;
  public readonly requestId?: string;

  constructor(params: { message: string; code: string; status: number; details?: unknown; requestId?: string }) {
    super(params.message);
    this.name = 'ApiError';
    this.code = params.code;
    this.status = params.status;
    this.details = params.details;
    this.requestId = params.requestId;
  }
}

const API_BASE = (import.meta.env.VITE_API_URL || '').replace(/\/+$/, '');

/** Читает CSRF-токен из cookie (её ставит сервер при входе). */
export function readCsrfToken(): string {
  const match = document.cookie.match(/(?:^|;\s*)so2_csrf=([^;]+)/);
  return match?.[1] ? decodeURIComponent(match[1]) : '';
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  /** Ключ идемпотентности для платёжных и игровых операций. */
  idempotencyKey?: string;
  signal?: AbortSignal;
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const method = options.method ?? 'GET';
  const headers: Record<string, string> = { Accept: 'application/json' };

  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET') {
    const token = readCsrfToken();
    if (token) headers['X-CSRF-Token'] = token;
  }
  if (options.idempotencyKey) headers['Idempotency-Key'] = options.idempotencyKey;

  let response: Response;
  try {
    response = await fetch(`${API_BASE}/api${path}`, {
      method,
      headers,
      credentials: 'include',
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal,
    });
  } catch (error) {
    if ((error as Error).name === 'AbortError') throw error;
    throw new ApiError({
      message: 'Нет связи с сервером. Проверьте подключение к интернету.',
      code: 'NETWORK_ERROR',
      status: 0,
    });
  }

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    const errorBody = (payload as { error?: { code?: string; message?: string; details?: unknown; requestId?: string } })
      ?.error;
    throw new ApiError({
      message: errorBody?.message ?? `Ошибка запроса (${response.status})`,
      code: errorBody?.code ?? 'UNKNOWN_ERROR',
      status: response.status,
      details: errorBody?.details,
      requestId: errorBody?.requestId,
    });
  }

  return payload as T;
}

/** Собирает строку запроса, отбрасывая пустые значения. */
export function queryString(params: Record<string, string | number | boolean | undefined | null>): string {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return;
    search.set(key, String(value));
  });
  const result = search.toString();
  return result ? `?${result}` : '';
}

/** Генерирует ключ идемпотентности для одной попытки операции. */
export function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `key-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** Адрес начала входа через Google (обычный переход, не fetch). */
export function googleLoginUrl(returnTo = '/'): string {
  return `${API_BASE}/api/auth/google${queryString({ returnTo })}`;
}
