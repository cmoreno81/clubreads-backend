import type { NextFunction, Request, Response } from 'express';
import { rateLimit } from 'express-rate-limit';

type LimitGroup = 'credentials' | 'email' | 'code' | null;

const CREDENTIAL_ACTIONS = new Set(['login', 'refreshToken']);
const EMAIL_ACTIONS = new Set([
  'solicitarActivacion',
  'solicitarRegistro',
  'solicitarResetPassword',
]);
const CODE_ACTIONS = new Set([
  'activarCuenta',
  'completarRegistro',
  'resetPassword',
]);

function positiveIntegerFromEnv(name: string, fallback: number) {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;

  const value = Number(raw);
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

function createLimiter(windowMs: number, limit: number, mensaje: string) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (_req, res) =>
      res.status(429).json({
        ok: false,
        error: 'RATE_LIMITED',
        mensaje,
      }),
  });
}

export function getPublicAuthRateLimitGroup(action: string): LimitGroup {
  if (CREDENTIAL_ACTIONS.has(action)) return 'credentials';
  if (EMAIL_ACTIONS.has(action)) return 'email';
  if (CODE_ACTIONS.has(action)) return 'code';
  return null;
}

export const apiRateLimiter = createLimiter(
  positiveIntegerFromEnv('RATE_LIMIT_API_WINDOW_MS', 60_000),
  positiveIntegerFromEnv('RATE_LIMIT_API_MAX', 120),
  'Has realizado demasiadas solicitudes. Inténtalo de nuevo en unos minutos.',
);

export const healthRateLimiter = createLimiter(
  positiveIntegerFromEnv('RATE_LIMIT_HEALTH_WINDOW_MS', 60_000),
  positiveIntegerFromEnv('RATE_LIMIT_HEALTH_MAX', 60),
  'Demasiadas comprobaciones de estado. Inténtalo de nuevo más tarde.',
);

const credentialsRateLimiter = createLimiter(
  positiveIntegerFromEnv('RATE_LIMIT_AUTH_WINDOW_MS', 10 * 60_000),
  positiveIntegerFromEnv('RATE_LIMIT_AUTH_MAX', 10),
  'Demasiados intentos de acceso. Espera antes de volver a intentarlo.',
);

const emailRateLimiter = createLimiter(
  positiveIntegerFromEnv('RATE_LIMIT_EMAIL_WINDOW_MS', 60 * 60_000),
  positiveIntegerFromEnv('RATE_LIMIT_EMAIL_MAX', 3),
  'Demasiadas solicitudes. Espera antes de pedir otro correo.',
);

const codeRateLimiter = createLimiter(
  positiveIntegerFromEnv('RATE_LIMIT_CODE_WINDOW_MS', 15 * 60_000),
  positiveIntegerFromEnv('RATE_LIMIT_CODE_MAX', 8),
  'Demasiados intentos de confirmación. Espera antes de volver a intentarlo.',
);

export function publicAuthRateLimiter(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const group = getPublicAuthRateLimitGroup(String(req.query.action || ''));

  if (group === 'credentials') return credentialsRateLimiter(req, res, next);
  if (group === 'email') return emailRateLimiter(req, res, next);
  if (group === 'code') return codeRateLimiter(req, res, next);
  return next();
}

export function createRateLimiterForTest(limit: number) {
  return createLimiter(60_000, limit, 'Solicitud limitada para la prueba.');
}
