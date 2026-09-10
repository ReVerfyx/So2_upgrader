/** Маршруты авторизации: логин/пароль, Google OAuth, сессии. */
import { Router } from 'express';
import { z } from 'zod';
import { env } from '../config/env';
import { asyncHandler } from '../lib/asyncHandler';
import { parseOrThrow, sanitizeText } from '../lib/validate';
import { badRequest, unauthorized } from '../lib/errors';
import { logger } from '../lib/logger';
import { rateLimit } from '../middleware/rateLimit';
import { clearSessionCookie, requireAuth, setSessionCookie } from '../middleware/auth';
import {
  changePassword,
  createSession,
  login,
  loginWithExternal,
  register,
  revokeSession,
} from '../services/authService';
import {
  buildAuthUrl,
  createState,
  exchangeCode,
  isGoogleEnabled,
  resolveSuccessRedirect,
  verifyIdToken,
  verifyState,
} from '../services/googleOAuth';
import { getBalance } from '../services/balanceService';
import { money } from '../lib/money';

export const authRouter = Router();

const credentialsSchema = z.object({
  username: z.string().min(3).max(32),
  password: z.string().min(8).max(128),
  displayName: z.string().min(2).max(48).optional(),
});

const loginLimiter = rateLimit({ name: 'login', windowMs: 5 * 60_000, max: 10, message: 'Слишком много попыток входа. Подождите несколько минут.' });
const registerLimiter = rateLimit({ name: 'register', windowMs: 60 * 60_000, max: 5, message: 'Слишком много регистраций с этого адреса.' });

function userResponse(user: Awaited<ReturnType<typeof login>>): Record<string, unknown> {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    email: user.email,
    role: user.role,
    avatarUrl: user.avatarUrl,
    gameNickname: user.gameNickname,
    contact: user.contact,
    createdAt: user.createdAt,
  };
}

authRouter.post(
  '/register',
  registerLimiter,
  asyncHandler(async (req, res) => {
    const input = parseOrThrow(credentialsSchema, req.body);
    const user = await register({
      username: input.username,
      password: input.password,
      displayName: input.displayName ? sanitizeText(input.displayName, 48) : undefined,
    });
    const session = await createSession(user.id, { userAgent: req.get('user-agent'), ip: req.ip });
    setSessionCookie(res, session.token, session.csrfToken, session.expiresAt);
    res.status(201).json({ user: userResponse(user), csrfToken: session.csrfToken });
  }),
);

authRouter.post(
  '/login',
  loginLimiter,
  asyncHandler(async (req, res) => {
    const input = parseOrThrow(credentialsSchema.pick({ username: true, password: true }), req.body);
    const user = await login(input.username, input.password);
    const session = await createSession(user.id, { userAgent: req.get('user-agent'), ip: req.ip });
    setSessionCookie(res, session.token, session.csrfToken, session.expiresAt);
    const balance = await getBalance(user.id);
    res.json({ user: userResponse(user), balance: money(balance.amountMinor), csrfToken: session.csrfToken });
  }),
);

authRouter.post(
  '/logout',
  asyncHandler(async (req, res) => {
    if (req.sessionId) await revokeSession(req.sessionId);
    clearSessionCookie(res);
    res.json({ ok: true });
  }),
);

authRouter.post(
  '/password',
  requireAuth,
  rateLimit({ name: 'password-change', windowMs: 60 * 60_000, max: 5 }),
  asyncHandler(async (req, res) => {
    const input = parseOrThrow(
      z.object({ oldPassword: z.string().min(1).max(128), newPassword: z.string().min(8).max(128) }),
      req.body,
    );
    await changePassword(req.user!.id, input.oldPassword, input.newPassword);
    clearSessionCookie(res);
    res.json({ ok: true, message: 'Пароль изменён, войдите заново' });
  }),
);

/* ------------------------------ Google OAuth ----------------------------- */

const GOOGLE_STATE_COOKIE = 'so2_oauth_state';

authRouter.get(
  '/google',
  rateLimit({ name: 'google-start', windowMs: 5 * 60_000, max: 30 }),
  asyncHandler(async (req, res) => {
    if (!isGoogleEnabled()) {
      throw badRequest('Вход через Google не настроен на сервере', 'GOOGLE_OAUTH_DISABLED');
    }
    const returnTo = typeof req.query.returnTo === 'string' ? req.query.returnTo : '/';
    const { state, nonce } = createState(returnTo);

    // Дублируем state в httpOnly cookie — вторая линия защиты от CSRF.
    res.cookie(GOOGLE_STATE_COOKIE, state, {
      httpOnly: true,
      secure: env.security.cookieSecure,
      sameSite: 'lax',
      maxAge: 10 * 60_000,
      path: '/',
    });

    res.redirect(buildAuthUrl(state, nonce));
  }),
);

authRouter.get(
  '/google/callback',
  rateLimit({ name: 'google-callback', windowMs: 5 * 60_000, max: 30 }),
  asyncHandler(async (req, res) => {
    const failRedirect = (code: string): void => {
      const target = new URL(env.google.successRedirect || env.appUrl);
      target.searchParams.set('authError', code);
      res.redirect(target.toString());
    };

    if (typeof req.query.error === 'string') {
      logger.info('Пользователь отменил вход через Google', { error: req.query.error });
      failRedirect('google_cancelled');
      return;
    }

    const code = typeof req.query.code === 'string' ? req.query.code : '';
    const state = typeof req.query.state === 'string' ? req.query.state : '';
    if (!code || !state) {
      failRedirect('google_bad_request');
      return;
    }

    const cookieState = req.cookies?.[GOOGLE_STATE_COOKIE];
    res.clearCookie(GOOGLE_STATE_COOKIE, { path: '/' });
    if (cookieState !== state) {
      logger.warn('Не совпал state при возврате из Google');
      failRedirect('google_state_mismatch');
      return;
    }

    const payload = verifyState(state);
    const idToken = await exchangeCode(code);
    const profile = await verifyIdToken(idToken, payload.nonce);

    const user = await loginWithExternal({
      provider: 'google',
      externalId: profile.sub,
      displayName: sanitizeText(profile.name, 48),
      email: profile.email,
      emailVerified: profile.emailVerified,
      avatarUrl: profile.picture,
    });

    const session = await createSession(user.id, { userAgent: req.get('user-agent'), ip: req.ip });
    setSessionCookie(res, session.token, session.csrfToken, session.expiresAt);

    res.redirect(resolveSuccessRedirect(payload.returnTo));
  }),
);

/* ------------------------- Тестовый вход (dev) --------------------------- */

authRouter.post(
  '/test-login',
  asyncHandler(async (req, res) => {
    if (!env.testMode) throw unauthorized('Тестовый вход отключён', 'TEST_MODE_DISABLED');
    const input = parseOrThrow(z.object({ username: z.string().min(3).max(32) }), req.body);
    const user = await loginWithExternal({
      provider: 'test',
      externalId: input.username.toLowerCase(),
      displayName: input.username,
    });
    const session = await createSession(user.id, { userAgent: req.get('user-agent'), ip: req.ip });
    setSessionCookie(res, session.token, session.csrfToken, session.expiresAt);
    res.json({ user: userResponse(user), csrfToken: session.csrfToken });
  }),
);
