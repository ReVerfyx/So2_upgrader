/** Сборка Express-приложения: middleware безопасности и все маршруты. */
import express, { type Express } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { env } from './config/env';
import { requestId } from './middleware/requestId';
import { errorHandler, notFoundHandler } from './middleware/error';
import { attachUser } from './middleware/auth';
import { csrfProtection } from './middleware/csrf';
import { rateLimit } from './middleware/rateLimit';
import { healthRouter } from './routes/health';
import { authRouter } from './routes/auth';
import { userRouter } from './routes/user';
import { itemsRouter } from './routes/items';
import { inventoryRouter } from './routes/inventory';
import { upgradeRouter } from './routes/upgrade';
import { depositRouter } from './routes/deposit';
import { withdrawRouter } from './routes/withdraw';
import { adminRouter } from './routes/admin';
import { devRouter } from './routes/dev';

export function createApp(): Express {
  const app = express();

  if (env.trustProxy) app.set('trust proxy', 1);
  app.disable('x-powered-by');

  // Заголовки безопасности. CSP для API не нужна (JSON), статику отдаёт nginx.
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    }),
  );

  app.use(
    cors({
      origin: (origin, callback) => {
        // Запросы без Origin (curl, мобильные приложения) не блокируем:
        // безопасность обеспечивают cookie SameSite и проверка CSRF.
        if (!origin || env.corsOrigins.includes(origin)) {
          callback(null, true);
          return;
        }
        callback(new Error(`Источник ${origin} не разрешён политикой CORS`));
      },
      credentials: true,
      exposedHeaders: ['X-Request-Id'],
    }),
  );

  app.use(express.json({ limit: '256kb' }));
  app.use(express.urlencoded({ extended: false, limit: '64kb' }));
  app.use(cookieParser());
  app.use(requestId);

  // Общий предохранитель по частоте запросов.
  app.use(rateLimit({ name: 'global', windowMs: 60_000, max: 600 }));

  app.use(attachUser);
  app.use(csrfProtection);

  const api = express.Router();
  api.use(healthRouter);
  api.use('/auth', authRouter);
  api.use(userRouter);
  api.use(itemsRouter);
  api.use(inventoryRouter);
  api.use(upgradeRouter);
  api.use(depositRouter);
  api.use(withdrawRouter);
  api.use('/admin', adminRouter);

  // Тестовые эндпоинты не существуют в production в принципе.
  if (env.testMode && !env.isProduction) {
    api.use('/dev', devRouter);
  }

  app.use('/api', api);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
