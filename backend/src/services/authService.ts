/**
 * Авторизация и сессии.
 *
 * Принципы:
 *  - пароль хранится только в виде bcrypt-хеша;
 *  - в базе лежит HMAC-хеш сессионного токена, а не сам токен;
 *  - токен передаётся исключительно в httpOnly cookie (JS его не читает);
 *  - для каждой сессии выдаётся отдельный CSRF-токен;
 *  - архитектура готова к подключению внешнего провайдера (например,
 *    официального API Standoff 2) — см. linkExternalAccount/loginWithExternal.
 *    Поддельная форма ввода игрового пароля не создаётся принципиально.
 */
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import type { PoolClient } from 'pg';
import { pool } from '../db/pool';
import { query, queryOne, withTransaction, type Db } from '../db/tx';
import { env } from '../config/env';
import { conflict, forbidden, unauthorized } from '../lib/errors';
import { generateClientSeed, generateServerSeed, hashServerSeed } from '../lib/fairness';

export interface AuthenticatedUser {
  id: string;
  username: string;
  displayName: string;
  email: string | null;
  role: 'user' | 'admin';
  isBlocked: boolean;
  blockReason: string | null;
  avatarUrl: string | null;
  gameNickname: string | null;
  contact: string | null;
  createdAt: Date;
}

interface UserRow {
  id: string;
  username: string;
  display_name: string;
  password_hash: string | null;
  email: string | null;
  role: 'user' | 'admin';
  is_blocked: boolean;
  block_reason: string | null;
  avatar_url: string | null;
  game_nickname: string | null;
  contact: string | null;
  external_provider: string | null;
  external_id: string | null;
  created_at: Date;
}

export function mapUser(row: UserRow): AuthenticatedUser {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    email: row.email,
    role: row.role,
    isBlocked: row.is_blocked,
    blockReason: row.block_reason,
    avatarUrl: row.avatar_url,
    gameNickname: row.game_nickname,
    contact: row.contact,
    createdAt: row.created_at,
  };
}

/** HMAC-хеш сессионного токена: даже дамп базы не даёт войти в аккаунт. */
export function hashSessionToken(token: string): string {
  return crypto.createHmac('sha256', env.security.sessionSecret).update(token).digest('hex');
}

export interface CreatedSession {
  token: string;
  csrfToken: string;
  sessionId: string;
  expiresAt: Date;
}

export async function createSession(
  userId: string,
  meta: { userAgent?: string; ip?: string },
  db: Db = pool,
): Promise<CreatedSession> {
  const token = crypto.randomBytes(48).toString('hex');
  const csrfToken = crypto.randomBytes(24).toString('hex');
  const expiresAt = new Date(Date.now() + env.security.sessionTtlHours * 3600_000);

  const row = await queryOne<{ id: string }>(
    `INSERT INTO sessions (user_id, token_hash, csrf_token, user_agent, ip, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [userId, hashSessionToken(token), csrfToken, meta.userAgent ?? null, meta.ip ?? null, expiresAt],
    db,
  );

  return { token, csrfToken, sessionId: row!.id, expiresAt };
}

export interface SessionContext {
  user: AuthenticatedUser;
  sessionId: string;
  csrfToken: string;
}

export async function resolveSession(token: string): Promise<SessionContext | null> {
  const row = await queryOne<UserRow & { session_id: string; csrf_token: string }>(
    `SELECT u.*, s.id AS session_id, s.csrf_token
       FROM sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1
        AND s.revoked_at IS NULL
        AND s.expires_at > now()`,
    [hashSessionToken(token)],
  );
  if (!row) return null;

  // Отметка активности не должна блокировать ответ.
  void pool
    .query('UPDATE sessions SET last_seen_at = now() WHERE id = $1', [row.session_id])
    .catch(() => undefined);

  return { user: mapUser(row), sessionId: row.session_id, csrfToken: row.csrf_token };
}

export async function revokeSession(sessionId: string): Promise<void> {
  await query('UPDATE sessions SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL', [sessionId]);
}

export async function revokeAllUserSessions(userId: string, db: Db = pool): Promise<void> {
  await query('UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [userId], db);
}

const USERNAME_RE = /^[a-zA-Z0-9_.-]{3,32}$/;

export async function register(params: {
  username: string;
  password: string;
  displayName?: string;
}): Promise<AuthenticatedUser> {
  if (!USERNAME_RE.test(params.username)) {
    throw conflict('Логин может содержать 3–32 символа: латиницу, цифры, «_», «.», «-»', 'INVALID_USERNAME');
  }
  if (params.password.length < 8) {
    throw conflict('Пароль должен содержать не менее 8 символов', 'WEAK_PASSWORD');
  }

  const usernameLower = params.username.toLowerCase();
  const existing = await queryOne('SELECT id FROM users WHERE username_lower = $1', [usernameLower]);
  if (existing) throw conflict('Такой логин уже занят', 'USERNAME_TAKEN');

  const passwordHash = await bcrypt.hash(params.password, env.security.bcryptRounds);
  const serverSeed = generateServerSeed();

  return withTransaction(async (client: PoolClient) => {
    const row = await queryOne<UserRow>(
      `INSERT INTO users (username, username_lower, display_name, password_hash,
                          server_seed, server_seed_hash, client_seed)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        params.username,
        usernameLower,
        params.displayName?.trim() || params.username,
        passwordHash,
        serverSeed,
        hashServerSeed(serverSeed),
        generateClientSeed(),
      ],
      client,
    );
    await query('INSERT INTO balances (user_id) VALUES ($1)', [row!.id], client);
    return mapUser(row!);
  });
}

export async function login(username: string, password: string): Promise<AuthenticatedUser> {
  const row = await queryOne<UserRow>('SELECT * FROM users WHERE username_lower = $1', [username.toLowerCase()]);

  // Сравнение выполняется всегда, чтобы по времени ответа нельзя было
  // определить существование логина.
  const hash = row?.password_hash ?? '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidiu';
  const valid = await bcrypt.compare(password, hash);

  if (!row || !valid) throw unauthorized('Неверный логин или пароль', 'INVALID_CREDENTIALS');
  if (row.is_blocked) throw forbidden(row.block_reason || 'Аккаунт заблокирован', 'USER_BLOCKED');

  await query('UPDATE users SET last_login_at = now() WHERE id = $1', [row.id]);
  return mapUser(row);
}

export async function changePassword(userId: string, oldPassword: string, newPassword: string): Promise<void> {
  if (newPassword.length < 8) throw conflict('Новый пароль должен содержать не менее 8 символов', 'WEAK_PASSWORD');
  const row = await queryOne<UserRow>('SELECT * FROM users WHERE id = $1', [userId]);
  if (!row?.password_hash) throw unauthorized('Пользователь не найден', 'USER_NOT_FOUND');
  const valid = await bcrypt.compare(oldPassword, row.password_hash);
  if (!valid) throw unauthorized('Текущий пароль указан неверно', 'INVALID_CREDENTIALS');

  const passwordHash = await bcrypt.hash(newPassword, env.security.bcryptRounds);
  await withTransaction(async (client) => {
    await query('UPDATE users SET password_hash = $1 WHERE id = $2', [passwordHash, userId], client);
    await revokeAllUserSessions(userId, client);
  });
}

export async function getUserById(userId: string, db: Db = pool): Promise<AuthenticatedUser | null> {
  const row = await queryOne<UserRow>('SELECT * FROM users WHERE id = $1', [userId], db);
  return row ? mapUser(row) : null;
}

export async function updateProfile(
  userId: string,
  patch: { displayName?: string; gameNickname?: string; contact?: string; avatarUrl?: string },
): Promise<AuthenticatedUser> {
  const row = await queryOne<UserRow>(
    `UPDATE users
        SET display_name  = COALESCE($2, display_name),
            game_nickname = COALESCE($3, game_nickname),
            contact       = COALESCE($4, contact),
            avatar_url    = COALESCE($5, avatar_url)
      WHERE id = $1
      RETURNING *`,
    [userId, patch.displayName ?? null, patch.gameNickname ?? null, patch.contact ?? null, patch.avatarUrl ?? null],
  );
  if (!row) throw unauthorized('Пользователь не найден', 'USER_NOT_FOUND');
  return mapUser(row);
}

/* ---------------------------------------------------------------------------
 * Задел под внешнюю авторизацию (Standoff 2 / игровой аккаунт).
 *
 * Реализация намеренно не запрашивает пароль внешнего аккаунта: вход возможен
 * только по подтверждённому идентификатору от официального провайдера
 * (OAuth/OpenID). До появления такого API функция используется в тестах
 * и для интеграций администратора.
 * ------------------------------------------------------------------------- */
export interface ExternalIdentity {
  provider: string;
  externalId: string;
  displayName: string;
  email?: string | null;
  /** Подтверждён ли адрес почты провайдером. Только при true допускается
   *  привязка к уже существующему аккаунту с тем же email. */
  emailVerified?: boolean;
  avatarUrl?: string | null;
}

/** Подбирает свободный логин на основе имени внешнего аккаунта. */
async function generateUniqueUsername(base: string, db: Db = pool): Promise<string> {
  const normalized = base
    .toLowerCase()
    .replace(/[^a-z0-9_.-]/g, '')
    .replace(/^[._-]+/, '')
    .slice(0, 24);
  const seed = normalized.length >= 3 ? normalized : `player${crypto.randomInt(1000, 9999)}`;

  for (let attempt = 0; attempt < 25; attempt += 1) {
    const candidate = attempt === 0 ? seed : `${seed}${crypto.randomInt(10, 9999)}`.slice(0, 32);
    const taken = await queryOne('SELECT 1 FROM users WHERE username_lower = $1', [candidate], db);
    if (!taken) return candidate;
  }
  return `player_${crypto.randomBytes(6).toString('hex')}`;
}

/**
 * Вход через внешнего провайдера (Google, в перспективе — официальный API Standoff 2).
 *
 * Порядок поиска аккаунта:
 *  1. по паре (провайдер, идентификатор) — основной путь;
 *  2. по подтверждённому email — привязка к существующему аккаунту,
 *     чтобы человек с логином и паролем мог войти и через Google;
 *  3. иначе создаётся новый пользователь с нулевым балансом.
 *
 * Пароль внешнего аккаунта никогда не запрашивается и не сохраняется.
 */
export async function loginWithExternal(identity: ExternalIdentity): Promise<AuthenticatedUser> {
  const existing = await queryOne<UserRow>(
    'SELECT * FROM users WHERE external_provider = $1 AND external_id = $2',
    [identity.provider, identity.externalId],
  );
  if (existing) {
    if (existing.is_blocked) throw forbidden(existing.block_reason || 'Аккаунт заблокирован', 'USER_BLOCKED');
    const updated = await queryOne<UserRow>(
      `UPDATE users
          SET last_login_at = now(),
              display_name = COALESCE(NULLIF($2, ''), display_name),
              avatar_url   = COALESCE($3, avatar_url)
        WHERE id = $1
        RETURNING *`,
      [existing.id, identity.displayName, identity.avatarUrl ?? null],
    );
    return mapUser(updated!);
  }

  // Привязка к существующему аккаунту по подтверждённой почте.
  if (identity.email && identity.emailVerified) {
    const byEmail = await queryOne<UserRow>('SELECT * FROM users WHERE lower(email) = lower($1)', [identity.email]);
    if (byEmail) {
      if (byEmail.is_blocked) throw forbidden(byEmail.block_reason || 'Аккаунт заблокирован', 'USER_BLOCKED');
      if (byEmail.external_provider && byEmail.external_provider !== identity.provider) {
        throw conflict('Этот адрес уже привязан к другому способу входа', 'EMAIL_LINKED_TO_OTHER_PROVIDER');
      }
      const linked = await queryOne<UserRow>(
        `UPDATE users
            SET external_provider = $2,
                external_id       = $3,
                avatar_url        = COALESCE(avatar_url, $4),
                last_login_at     = now()
          WHERE id = $1
          RETURNING *`,
        [byEmail.id, identity.provider, identity.externalId, identity.avatarUrl ?? null],
      );
      await query('INSERT INTO balances (user_id) VALUES ($1) ON CONFLICT DO NOTHING', [byEmail.id]);
      return mapUser(linked!);
    }
  }

  const serverSeed = generateServerSeed();
  const username = await generateUniqueUsername(identity.email?.split('@')[0] || identity.displayName);

  return withTransaction(async (client) => {
    const row = await queryOne<UserRow>(
      `INSERT INTO users (username, username_lower, display_name, email, role, avatar_url,
                          external_provider, external_id, server_seed, server_seed_hash, client_seed)
       VALUES ($1, $2, $3, $4, 'user', $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [
        username,
        username,
        identity.displayName,
        identity.emailVerified ? identity.email ?? null : null,
        identity.avatarUrl ?? null,
        identity.provider,
        identity.externalId,
        serverSeed,
        hashServerSeed(serverSeed),
        generateClientSeed(),
      ],
      client,
    );
    await query('INSERT INTO balances (user_id) VALUES ($1)', [row!.id], client);
    return mapUser(row!);
  });
}
