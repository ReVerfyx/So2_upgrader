/**
 * Защита от CSRF по схеме «double submit».
 *
 * У каждой сессии есть собственный CSRF-токен: он лежит в обычной cookie
 * (её читает фронтенд) и обязан прийти в заголовке X-CSRF-Token.
 * Стороннему сайту заголовок подделать нельзя, поэтому запрос
 * с чужой страницы будет отклонён.
 *
 * Проверка применяется ко всем изменяющим методам для авторизованных
 * пользователей. Вход и регистрация от неё освобождены (сессии ещё нет),
 * там работает ограничение частоты запросов.
 */
import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { forbidden } from '../lib/errors';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function csrfProtection(req: Request, _res: Response, next: NextFunction): void {
  if (SAFE_METHODS.has(req.method)) {
    next();
    return;
  }
  // Незалогиненные запросы (вход, регистрация) защищены rate limit'ом.
  if (!req.user || !req.csrfToken) {
    next();
    return;
  }

  const header = req.get('X-CSRF-Token') ?? '';
  const expected = req.csrfToken;

  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    next(forbidden('Не пройдена проверка CSRF. Обновите страницу и попробуйте снова.', 'CSRF_TOKEN_INVALID'));
    return;
  }

  next();
}
