import { prisma } from '../prisma.js';
import { findBestBookCover } from './book-cover.service.js';

// Backfill de año de publicación e ISBN, completamente separado del backfill
// de idioma (book-language-backfill.service.ts) a propósito: no comparte
// código ni tocan las mismas columnas, para que un fallo aquí no pueda
// afectar a lo que ya funciona con el idioma.
//
// SOLO añade datos que faltan (publicationYear/isbn a null): nunca
// sobrescribe un valor que el libro ya tuviera.
//
// Páginas queda fuera: OpenLibrary no las incluye en esta misma búsqueda
// (search.json), solo en una llamada aparte por edición — mucho más lenta
// y con más margen de error, así que no se ha añadido aquí.

const DEFAULT_BATCH_SIZE = 200;
const MAX_BATCH_SIZE = 500;
const LOOKUP_DELAY_MS = 250;

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

export async function backfillMissingBookMetadata(
  options: { apply?: boolean; limit?: number } = {},
) {
  const startedAt = Date.now();
  const limit = boundedLimit(options.limit);

  const books = await prisma.book.findMany({
    where: {
      deletedAt: null,
      OR: [{ publicationYear: null }, { isbn: null }],
    },
    select: {
      id: true,
      title: true,
      isbn: true,
      publicationYear: true,
      author: { select: { name: true } },
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: limit,
  });

  const matches: Array<{
    bookId: string;
    title: string;
    publicationYear?: number;
    isbn?: string;
  }> = [];
  let added = 0;
  let omitted = 0;
  let failures = 0;

  for (const book of books) {
    try {
      const match = await findBestBookCover(book.title);
      const candidate = match.candidate;

      if (!match.safeToApply || !candidate) {
        omitted++;
        await wait(LOOKUP_DELAY_MS);
        continue;
      }

      // Solo rellenamos lo que el libro NO tuviera ya.
      const data: { publicationYear?: number; isbn?: string } = {};
      if (book.publicationYear === null && candidate.publicationYear) {
        data.publicationYear = candidate.publicationYear;
      }
      if (book.isbn === null && candidate.isbn) {
        data.isbn = candidate.isbn;
      }

      if (Object.keys(data).length === 0) {
        omitted++;
        await wait(LOOKUP_DELAY_MS);
        continue;
      }

      matches.push({ bookId: book.id, title: book.title, ...data });

      if (options.apply) {
        // Guarda extra: el where repite la condición "sigue siendo null"
        // para no pisar un valor que otra petición hubiera puesto mientras
        // tanto.
        const result = await prisma.book.updateMany({
          where: {
            id: book.id,
            deletedAt: null,
            ...(data.publicationYear !== undefined
              ? { publicationYear: null }
              : {}),
            ...(data.isbn !== undefined ? { isbn: null } : {}),
          },
          data,
        });
        added += result.count;
        if (result.count === 0) omitted++;
      } else {
        omitted++;
      }
    } catch {
      failures++;
    }
    await wait(LOOKUP_DELAY_MS);
  }

  return {
    mode: options.apply ? 'APPLY' : 'PREVIEW',
    examined: books.length,
    matches,
    added,
    omitted,
    failures,
    durationMs: Date.now() - startedAt,
  };
}
