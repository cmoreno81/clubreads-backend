import { pathToFileURL } from 'node:url';
import express from 'express';
import type { Server } from 'node:http';
import type { Request, Response } from 'express';

import { apiRouter } from './routes/api.router.js';
import { prisma } from './prisma.js';
import {
  apiRateLimiter,
  healthRateLimiter,
} from './middleware/rate-limit.middleware.js';
import {
  corsErrorHandler,
  createCorsMiddleware,
  createHelmetMiddleware,
} from './middleware/http-security.middleware.js';
import { logger } from './logging/logger.js';
import {
  globalErrorHandler,
  requestObservability,
} from './middleware/request-observability.middleware.js';

export function proxyHops() {
  const fallback = process.env.NODE_ENV === 'production' ? 1 : 0;
  const raw = process.env.TRUST_PROXY_HOPS?.trim();
  if (!raw) return fallback;

  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= 0 && value <= 5
    ? value
    : fallback;
}

export function healthHandler(_req: Request, res: Response) {
  return res.json({ ok: true, status: 'healthy' });
}

export async function readinessHandler(_req: Request, res: Response) {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return res.json({ ok: true, status: 'ready' });
  } catch {
    return res.status(503).json({
      ok: false,
      error: 'NOT_READY',
      mensaje: 'El servicio no está preparado',
    });
  }
}

export function createApp() {
  const app = express();
  app.set('trust proxy', proxyHops());
  app.use(requestObservability());

  app.use(createHelmetMiddleware());
  app.use(createCorsMiddleware());
  app.use(corsErrorHandler);

  app.get('/health', healthRateLimiter, healthHandler);
  app.get('/ready', healthRateLimiter, readinessHandler);

  app.use(express.json({ limit: '5mb' }));
  app.use('/api', apiRateLimiter, apiRouter);
  app.use(globalErrorHandler());
  return app;
}

export function installGracefulShutdown(
  server: Server,
  timeoutMs = 10_000,
) {
  let shuttingDown = false;
  const shutdown = async (signal: NodeJS.Signals) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ event: 'shutdown_started', signal }, 'graceful shutdown started');

    const timeout = setTimeout(() => {
      logger.error({ event: 'shutdown_timeout' }, 'graceful shutdown timed out');
      process.exit(1);
    }, timeoutMs);
    timeout.unref();

    server.close(async (error) => {
      try {
        await prisma.$disconnect();
      } finally {
        clearTimeout(timeout);
        process.exit(error ? 1 : 0);
      }
    });
    server.closeIdleConnections?.();
  };

  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
  return shutdown;
}

export function startServer() {
  const app = createApp();
  const port = Number(process.env.PORT) || 3000;
  const server = app.listen(port, () => {
    logger.info({ event: 'server_started', port }, 'server started');
  });
  installGracefulShutdown(server);
  return server;
}

const entrypoint = process.argv[1]
  ? pathToFileURL(process.argv[1]).href
  : '';
if (import.meta.url === entrypoint) startServer();
