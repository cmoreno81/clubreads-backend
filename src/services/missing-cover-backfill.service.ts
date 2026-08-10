import { Client } from 'pg';

import { prisma } from '../prisma.js';
import { findImportedBookCover } from './book-cover.service.js';

const DEFAULT_BATCH_SIZE = 200;
const MAX_BATCH_SIZE = 500;
const LOOKUP_DELAY_MS = 250;
const LOOKUP_TIMEOUT_MS = 30_000;
const ADVISORY_LOCK_KEY = 1_835_101_729;

type BackfillDatabase = Pick<typeof prisma, 'book'>;
type CoverLookup = typeof findImportedBookCover;

export type CoverBackfillSummary = {
  skipped: boolean;
  reason?: 'LOCKED';
  examined: number;
  added: number;
  omitted: number;
  failures: number;
  durationMs: number;
};

type BackfillDependencies = {
  database?: BackfillDatabase;
  findCover?: CoverLookup;
  pause?: (milliseconds: number) => Promise<void>;
  lookupTimeoutMs?: number;
};

type LockClient = {
  connect(): Promise<unknown>;
  query<T extends Record<string, unknown>>(text: string, values?: unknown[]): Promise<{ rows: T[] }>;
  end(): Promise<unknown>;
};

type JobDependencies = BackfillDependencies & {
  createLockClient?: () => LockClient;
  executeBackfill?: typeof backfillMissingBookCovers;
};

function wait(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

function boundedLimit(value?: number) {
  if (value === undefined) return DEFAULT_BATCH_SIZE;
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`limit debe ser un entero entre 1 y ${MAX_BATCH_SIZE}`);
  }
  return Math.min(value, MAX_BATCH_SIZE);
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number) {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('COVER_LOOKUP_TIMEOUT')), timeoutMs);
        timer.unref();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function backfillMissingBookCovers(
  options: { apply?: boolean; limit?: number } = {},
  dependencies: BackfillDependencies = {},
) {
  const startedAt = Date.now();
  const database = dependencies.database ?? prisma;
  const findCover = dependencies.findCover ?? findImportedBookCover;
  const pause = dependencies.pause ?? wait;
  const lookupTimeoutMs = dependencies.lookupTimeoutMs ?? LOOKUP_TIMEOUT_MS;
  const limit = boundedLimit(options.limit);
  const books = await database.book.findMany({
    where: {
      deletedAt: null,
      OR: [{ coverUrl: null }, { coverUrl: '' }],
    },
    select: {
      id: true,
      title: true,
      isbn: true,
      author: { select: { name: true } },
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: limit,
  });

  const matches: Array<{ bookId: string; title: string; coverUrl: string }> = [];
  let added = 0;
  let omitted = 0;
  let failures = 0;
  for (const book of books) {
    try {
      const coverUrl = await withTimeout(findCover({
        title: book.title,
        author: book.author?.name ?? '',
        isbn: book.isbn ?? '',
      }), lookupTimeoutMs);
      if (!coverUrl) {
        omitted++;
      } else {
        matches.push({ bookId: book.id, title: book.title, coverUrl });
        if (options.apply) {
          const result = await database.book.updateMany({
            where: {
              id: book.id,
              deletedAt: null,
              OR: [{ coverUrl: null }, { coverUrl: '' }],
            },
            data: { coverUrl },
          });
          added += result.count;
          if (result.count === 0) omitted++;
        } else {
          omitted++;
        }
      }
    } catch {
      failures++;
    }
    await pause(LOOKUP_DELAY_MS);
  }

  return {
    skipped: false,
    checked: books.length,
    found: matches.length,
    applied: added,
    matches,
    examined: books.length,
    added,
    omitted,
    failures,
    durationMs: Date.now() - startedAt,
  };
}

function defaultLockClient() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL no está definida');
  return new Client({ connectionString }) as unknown as LockClient;
}

export async function runMissingCoverBackfillJob(
  options: { limit?: number } = {},
  dependencies: JobDependencies = {},
): Promise<CoverBackfillSummary> {
  const backfillEnabled = process.env.COVER_BACKFILL_ENABLED ?? (
    process.env.NODE_ENV === 'production' ? 'true' : 'false'
  );
  if (
    backfillEnabled !== 'true' &&
    !dependencies.executeBackfill
  ) {
    throw new Error('El backfill de portadas está desactivado');
  }
  const startedAt = Date.now();
  const lockClient = (dependencies.createLockClient ?? defaultLockClient)();
  let connected = false;
  let acquired = false;
  try {
    await lockClient.connect();
    connected = true;
    const lock = await lockClient.query<{ acquired: boolean }>(
      'SELECT pg_try_advisory_lock($1) AS acquired',
      [ADVISORY_LOCK_KEY],
    );
    acquired = lock.rows[0]?.acquired === true;
    if (!acquired) {
      return {
        skipped: true,
        reason: 'LOCKED',
        examined: 0,
        added: 0,
        omitted: 0,
        failures: 0,
        durationMs: Date.now() - startedAt,
      };
    }

    const execute = dependencies.executeBackfill ?? backfillMissingBookCovers;
    const result = await execute(
      { apply: true, limit: options.limit },
      dependencies,
    );
    return {
      skipped: false,
      examined: result.examined,
      added: result.added,
      omitted: result.omitted,
      failures: result.failures,
      durationMs: Date.now() - startedAt,
    };
  } finally {
    if (connected && acquired) {
      try {
        await lockClient.query('SELECT pg_advisory_unlock($1)', [ADVISORY_LOCK_KEY]);
      } catch {
        // Cerrar la sesión libera también el advisory lock.
      }
    }
    if (connected) await lockClient.end();
  }
}
