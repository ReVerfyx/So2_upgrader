import type { AuthenticatedUser } from '../services/authService';

declare global {
  namespace Express {
    interface Request {
      /** Уникальный идентификатор запроса — попадает в логи и ответы об ошибках. */
      requestId: string;
      /** Текущий пользователь (заполняется middleware авторизации). */
      user?: AuthenticatedUser;
      /** Идентификатор активной сессии. */
      sessionId?: string;
      /** CSRF-токен текущей сессии. */
      csrfToken?: string;
    }
  }
}

export {};
