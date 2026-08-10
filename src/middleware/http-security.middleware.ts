import type { ErrorRequestHandler, RequestHandler } from 'express';
import cors, { type CorsOptions } from 'cors';
import helmet from 'helmet';

const LOCAL_DEVELOPMENT_ORIGINS = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
];

export class CorsPolicyError extends Error {}

export function allowedCorsOrigins(env: NodeJS.ProcessEnv = process.env) {
  const configured = (env.CORS_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  return new Set(
    env.NODE_ENV === 'production'
      ? configured
      : [...configured, ...LOCAL_DEVELOPMENT_ORIGINS],
  );
}

export function createCorsOptions(
  env: NodeJS.ProcessEnv = process.env,
): CorsOptions {
  const allowedOrigins = allowedCorsOrigins(env);

  return {
    origin(origin, callback) {
      if (!origin || allowedOrigins.has(origin)) {
        callback(null, true);
        return;
      }

      callback(new CorsPolicyError('CORS origin rejected'));
    },
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type', 'Accept'],
    credentials: false,
    maxAge: 600,
    optionsSuccessStatus: 204,
  };
}

export function createCorsMiddleware(
  env: NodeJS.ProcessEnv = process.env,
): RequestHandler {
  return cors(createCorsOptions(env));
}

export function createHelmetMiddleware(
  env: NodeJS.ProcessEnv = process.env,
): RequestHandler {
  return helmet({
    contentSecurityPolicy: false,
    strictTransportSecurity:
      env.NODE_ENV === 'production' ? undefined : false,
  });
}

export const corsErrorHandler: ErrorRequestHandler = (
  error,
  _req,
  res,
  next,
) => {
  if (!(error instanceof CorsPolicyError)) return next(error);

  res.status(403).json({
    ok: false,
    error: 'CORS_ORIGIN_DENIED',
    mensaje: 'El origen de la petición no está autorizado.',
  });
};
