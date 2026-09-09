/**
 * Авторизация по httpOnly cookie.
 * Токен сессии недоступен JavaScript'у страницы, поэтому XSS не позволяет
 * украсть сессию простым чтением document.cookie.
 */
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { env } from '../config/env';
import { forbidden, unauthorized } from '../lib/errors';
import { resolveSession } from '../services/authService';

/** Мягкая авторизация: заполняет req.user, но не требует входа. */
export async function attachUser(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const token = req.cookies?.[env.security.cookieName];
    if (typeof token === 'string' && token.length > 0) {
      const context = await resolveSession(token);
      if (context) {
        req.user = context.user;
        req.sessionId = context.sessionId;
        req.csrfToken = context.csrfToken;
      }
    }
    next();
  } catch (error) {
    next(error);
  }
}

/** Жёсткая авторизация: без входа дальше не пускаем. */
export const requireAuth: RequestHandler = (req, _res, next) => {
  if (!req.user) {
    next(unauthorized('Войдите в аккаунт, чтобы продолжить'));
    return;
  }
  if (req.user.isBlocked) {
    next(forbidden(req.user.blockReason || 'Аккаунт заблокирован', 'USER_BLOCKED'));
    return;
  }
  next();
};

/** Доступ только для администраторов. */
export const requireAdmin: RequestHandler = (req, _res, next) => {
  if (!req.user) {
    next(unauthorized('Войдите в аккаунт, чтобы продолжить'));
    return;
  }
  if (req.user.role !== 'admin') {
    next(forbidden('Недостаточно прав для этого действия', 'ADMIN_REQUIRED'));
    return;
  }
  next();
};

/** Установка cookie сессии. */
export function setSessionCookie(res: Response, token: string, csrfToken: string, expiresAt: Date): void {
  res.cookie(env.security.cookieName, token, {
    httpOnly: true,
    secure: env.isProduction,
    sameSite: 'lax',
    expires: expiresAt,
    path: '/',
  });
  // CSRF-токен читается фронтендом и возвращается в заголовке X-CSRF-Token.
  res.cookie(env.security.csrfCookieName, csrfToken, {
    httpOnly: false,
    secure: env.isProduction,
    sameSite: 'lax',
    expires: expiresAt,
    path: '/',
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(env.security.cookieName, { path: '/' });
  res.clearCookie(env.security.csrfCookieName, { path: '/' });
}
