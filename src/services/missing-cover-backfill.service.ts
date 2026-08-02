import { prisma } from '../prisma.js';
import { findImportedBookCover } from './book-cover.service.js';

const DEFAULT_BATCH_SIZE = 200;
const DEFAULT_INTERVAL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_INITIAL_DELAY_MS = 60 * 1000;
const LOOKUP_DELAY_MS = 250;

let running = false;

function wait(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

export async function backfillMissingBookCovers(options: {
  apply?: boolean;
  limit?: number;
} = {}) {
  if (running) {
    return { skipped: true, checked: 0, found: 0, applied: 0, matches: [] };
  }
  running = true;
  try {
    const limit = Math.min(Math.max(options.limit ?? DEFAULT_BATCH_SIZE, 1), 500);
    const books = await prisma.book.findMany({
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
    let applied = 0;
    for (const book of books) {
      const coverUrl = await findImportedBookCover({
        title: book.title,
        author: book.author?.name ?? '',
        isbn: book.isbn ?? '',
      });
      if (coverUrl) {
        matches.push({ bookId: book.id, title: book.title, coverUrl });
        if (options.apply) {
          const result = await prisma.book.updateMany({
            where: {
              id: book.id,
              deletedAt: null,
              OR: [{ coverUrl: null }, { coverUrl: '' }],
            },
            data: { coverUrl },
          });
          applied += result.count;
        }
      }
      await wait(LOOKUP_DELAY_MS);
    }
    return {
      skipped: false,
      checked: books.length,
      found: matches.length,
      applied,
      matches,
    };
  } finally {
    running = false;
  }
}

export function startMissingCoverBackfill() {
  if (
    process.env.NODE_ENV === 'test' ||
    process.env.COVER_BACKFILL_ENABLED?.trim().toLowerCase() === 'false'
  ) {
    return;
  }
  const execute = () => {
    void backfillMissingBookCovers({ apply: true }).catch((error) => {
      console.error('No se pudieron completar las portadas pendientes', error);
    });
  };
  const initialDelay = Number(process.env.COVER_BACKFILL_INITIAL_DELAY_MS) || DEFAULT_INITIAL_DELAY_MS;
  const interval = Number(process.env.COVER_BACKFILL_INTERVAL_MS) || DEFAULT_INTERVAL_MS;
  setTimeout(execute, Math.max(initialDelay, 5_000)).unref();
  setInterval(execute, Math.max(interval, 60 * 60 * 1000)).unref();
}
