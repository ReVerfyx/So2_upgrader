/** Проверка работоспособности сервиса и подключения к БД. */
import { Router } from 'express';
import { pool } from '../db/pool';
import { env } from '../config/env';
import { asyncHandler } from '../lib/asyncHandler';
import { getSiteSettings } from '../services/settingsService';
import { isGoogleEnabled } from '../services/googleOAuth';

export const healthRouter = Router();

healthRouter.get(
  '/health',
  asyncHandler(async (_req, res) => {
    const started = Date.now();
    let database = 'ok';
    try {
      await pool.query('SELECT 1');
    } catch {
      database = 'error';
    }
    res.json({
      status: database === 'ok' ? 'ok' : 'degraded',
      database,
      latencyMs: Date.now() - started,
      version: process.env.npm_package_version ?? '1.0.0',
      time: new Date().toISOString(),
    });
  }),
);

/** Публичная конфигурация для фронтенда (секретов здесь нет). */
healthRouter.get(
  '/config',
  asyncHandler(async (_req, res) => {
    const site = await getSiteSettings();
    res.json({
      testMode: env.testMode,
      minDepositTon: env.economy.minDepositTon,
      depositTtlMinutes: env.economy.depositTtlMinutes,
      tonConfigured: Boolean(env.ton.walletAddress),
      googleAuthEnabled: isGoogleEnabled(),
      maintenance: site.maintenance,
      announcement: site.announcement,
    });
  }),
);
