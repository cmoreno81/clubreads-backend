import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { logger, slowPrismaQueryMs } from './logging/logger.js';

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error('DATABASE_URL no está definida');
}

const adapter = new PrismaPg({ connectionString });

export const prisma = new PrismaClient({
  adapter,
  log: [{ emit: 'event', level: 'query' }],
});

prisma.$on('query', (event) => {
  if (event.duration < slowPrismaQueryMs()) return;
  logger.warn({
    event: 'prisma_slow_query',
    component: 'prisma',
    operation: 'query',
    durationMs: event.duration,
    target: event.target,
  }, 'slow Prisma query');
});
