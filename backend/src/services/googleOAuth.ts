/**
 * Вход и регистрация через Google (OAuth 2.0 Authorization Code Flow + OpenID Connect).
 *
 * Безопасность:
 *  - секрет клиента живёт только на сервере (переменные окружения),
 *    во фронтенд он не попадает;
 *  - параметр state подписан HMAC и дополнительно сверяется с cookie —
 *    защита от CSRF на этапе возврата из Google;
 *  - id_token проверяется полностью: подпись по JWKS Google, издатель,
 *    аудитория (client_id), срок действия и nonce;
 *  - пароль пользователя Google нам не передаётся и не запрашивается.
 */
import crypto from 'node:crypto';
import { env } from '../config/env';
import { AppError, badRequest } from '../lib/errors';
import { logger } from '../lib/logger';

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const JWKS_ENDPOINT = 'https://www.googleapis.com/oauth2/v3/certs';
const ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];
const STATE_TTL_MS = 10 * 60_000;

export interface GoogleProfile {
  sub: string;
  email: string | null;
  emailVerified: boolean;
  name: string;
  picture: string | null;
}

/** Настроен ли вход через Google. */
export function isGoogleEnabled(): boolean {
  return Boolean(env.google.clientId && env.google.clientSecret && env.google.redirectUri);
}

function requireEnabled(): void {
  if (!isGoogleEnabled()) {
    throw new AppError('Вход через Google не настроен на сервере', {
      status: 503,
      code: 'GOOGLE_OAUTH_DISABLED',
    });
  }
}

/* ------------------------------ state и nonce ---------------------------- */

export interface StatePayload {
  nonce: string;
  returnTo: string;
  issuedAt: number;
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

/** Создаёт подписанный state. Возвращает строку для Google и её же для cookie. */
export function createState(returnTo: string): { state: string; nonce: string } {
  const nonce = crypto.randomBytes(16).toString('hex');
  const payload: StatePayload = { nonce, returnTo, issuedAt: Date.now() };
  const body = base64url(JSON.stringify(payload));
  const signature = crypto.createHmac('sha256', env.security.sessionSecret).update(body).digest('base64url');
  return { state: `${body}.${signature}`, nonce };
}

/** Проверяет подпись и срок жизни state. */
export function verifyState(state: string): StatePayload {
  const [body, signature] = state.split('.');
  if (!body || !signature) throw badRequest('Некорректный параметр state', 'INVALID_OAUTH_STATE');

  const expected = crypto.createHmac('sha256', env.security.sessionSecret).update(body).digest('base64url');
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw badRequest('Подпись state не совпадает', 'INVALID_OAUTH_STATE');
  }

  const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as StatePayload;
  if (Date.now() - payload.issuedAt > STATE_TTL_MS) {
    throw badRequest('Срок действия ссылки авторизации истёк, попробуйте войти заново', 'OAUTH_STATE_EXPIRED');
  }
  return payload;
}

/* --------------------------------- ссылки -------------------------------- */

export function buildAuthUrl(state: string, nonce: string): string {
  requireEnabled();
  const url = new URL(AUTH_ENDPOINT);
  url.searchParams.set('client_id', env.google.clientId);
  url.searchParams.set('redirect_uri', env.google.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'openid email profile');
  url.searchParams.set('state', state);
  url.searchParams.set('nonce', nonce);
  url.searchParams.set('prompt', 'select_account');
  url.searchParams.set('access_type', 'online');
  return url.toString();
}

/* --------------------------- обмен кода на токен ------------------------- */

interface TokenResponse {
  access_token?: string;
  id_token?: string;
  error?: string;
  error_description?: string;
}

export async function exchangeCode(code: string): Promise<string> {
  requireEnabled();
  const response = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: env.google.clientId,
      client_secret: env.google.clientSecret,
      redirect_uri: env.google.redirectUri,
      grant_type: 'authorization_code',
    }),
  });

  const data = (await response.json()) as TokenResponse;
  if (!response.ok || !data.id_token) {
    logger.warn('Google не выдал id_token', { status: response.status, error: data.error });
    throw new AppError('Не удалось завершить вход через Google', {
      status: 502,
      code: 'GOOGLE_TOKEN_EXCHANGE_FAILED',
    });
  }
  return data.id_token;
}

/* --------------------------- проверка id_token --------------------------- */

interface Jwk {
  kid: string;
  kty: string;
  alg: string;
  use: string;
  n: string;
  e: string;
}

let jwksCache: { keys: Jwk[]; expiresAt: number } | null = null;

async function getJwks(forceRefresh = false): Promise<Jwk[]> {
  if (!forceRefresh && jwksCache && jwksCache.expiresAt > Date.now()) return jwksCache.keys;

  const response = await fetch(JWKS_ENDPOINT);
  if (!response.ok) {
    throw new AppError('Не удалось получить ключи Google для проверки токена', {
      status: 502,
      code: 'GOOGLE_JWKS_UNAVAILABLE',
    });
  }
  const data = (await response.json()) as { keys: Jwk[] };
  // Кэшируем на срок из Cache-Control, но не дольше часа.
  const cacheControl = response.headers.get('cache-control') ?? '';
  const maxAge = Number(/max-age=(\d+)/.exec(cacheControl)?.[1] ?? '3600');
  jwksCache = { keys: data.keys, expiresAt: Date.now() + Math.min(maxAge, 3600) * 1000 };
  return data.keys;
}

interface IdTokenPayload {
  iss: string;
  aud: string;
  sub: string;
  exp: number;
  iat: number;
  nonce?: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  given_name?: string;
  picture?: string;
}

/** Полная проверка id_token: подпись, издатель, аудитория, срок, nonce. */
export async function verifyIdToken(idToken: string, expectedNonce: string): Promise<GoogleProfile> {
  requireEnabled();

  const parts = idToken.split('.');
  if (parts.length !== 3) throw badRequest('Некорректный формат id_token', 'INVALID_ID_TOKEN');
  const [headerB64, payloadB64, signatureB64] = parts as [string, string, string];

  const header = JSON.parse(Buffer.from(headerB64, 'base64url').toString('utf8')) as { alg: string; kid: string };
  if (header.alg !== 'RS256') throw badRequest('Неподдерживаемый алгоритм подписи id_token', 'INVALID_ID_TOKEN');

  let keys = await getJwks();
  let jwk = keys.find((key) => key.kid === header.kid);
  if (!jwk) {
    // Ключи Google ротируются — пробуем обновить кэш один раз.
    keys = await getJwks(true);
    jwk = keys.find((key) => key.kid === header.kid);
  }
  if (!jwk) throw badRequest('Ключ подписи Google не найден', 'INVALID_ID_TOKEN');

  const publicKey = crypto.createPublicKey({ key: jwk as unknown as crypto.JsonWebKey, format: 'jwk' });
  const verified = crypto
    .createVerify('RSA-SHA256')
    .update(`${headerB64}.${payloadB64}`)
    .verify(publicKey, Buffer.from(signatureB64, 'base64url'));

  if (!verified) throw badRequest('Подпись id_token недействительна', 'INVALID_ID_TOKEN');

  const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')) as IdTokenPayload;
  const now = Math.floor(Date.now() / 1000);

  if (!ISSUERS.includes(payload.iss)) throw badRequest('Неверный издатель id_token', 'INVALID_ID_TOKEN');
  if (payload.aud !== env.google.clientId) throw badRequest('Токен выдан другому приложению', 'INVALID_ID_TOKEN');
  if (payload.exp <= now) throw badRequest('Срок действия id_token истёк', 'ID_TOKEN_EXPIRED');
  if (payload.iat > now + 300) throw badRequest('Некорректное время выпуска id_token', 'INVALID_ID_TOKEN');
  if (payload.nonce !== expectedNonce) throw badRequest('Не совпадает nonce авторизации', 'INVALID_OAUTH_NONCE');

  return {
    sub: payload.sub,
    email: payload.email ?? null,
    emailVerified: Boolean(payload.email_verified),
    name: payload.name || payload.given_name || payload.email?.split('@')[0] || 'Игрок',
    picture: payload.picture ?? null,
  };
}

/** Куда вернуть пользователя после успешного входа. */
export function resolveSuccessRedirect(returnTo: string): string {
  const base = env.google.successRedirect || env.appUrl;
  try {
    const target = new URL(returnTo, base);
    const allowed = new URL(base);
    // Разрешаем возврат только на собственный домен.
    if (target.origin !== allowed.origin) return base;
    return target.toString();
  } catch {
    return base;
  }
}
