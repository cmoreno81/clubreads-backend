import assert from 'node:assert/strict';
import test from 'node:test';

import { ReadingStatus } from '@prisma/client';
import { actualizarProgresoLectura } from '../src/services/books.service.js';

// El total de páginas de un libro es un dato COMPARTIDO (Book.totalPages).
// Tras fusionar ediciones en distinto idioma, la paginación real de una
// lectora puede diferir de ese total de referencia. Estos tests verifican
// que corregir el propio total nunca sobrescribe el dato compartido — se
// guarda como ajuste personal (Library.personalTotalPages) — y que solo se
// establece el total global la primera vez que el libro no tenía ninguno.

function buildDb(library: {
  id: string;
  userId: string;
  bookId: string;
  status: ReadingStatus;
  currentPage: number | null;
  lastProgress: number | null;
  progressNote: string | null;
  personalTotalPages: number | null;
  book: { totalPages: number | null };
}) {
  const bookUpdates: unknown[] = [];
  const libraryUpdates: Array<Record<string, unknown>> = [];
  const db = {
    library: {
      findFirst: async () => ({
        ...library,
        book: { ...library.book },
      }),
      update: async ({ data }: { data: Record<string, unknown> }) => {
        libraryUpdates.push(data);
        Object.assign(library, data);
        return library;
      },
    },
    progressReaction: { deleteMany: async () => ({ count: 0 }) },
    book: {
      update: async ({ data }: { data: { totalPages: number } }) => {
        bookUpdates.push(data);
        library.book.totalPages = data.totalPages;
        return library.book;
      },
    },
    readingSession: { upsert: async () => ({ pagesRead: 0 }) },
    dailyCheckin: { upsert: async () => ({}) },
    $transaction: async (operations: Array<Promise<unknown>>) =>
      Promise.all(operations),
  };
  return { db, library, bookUpdates, libraryUpdates };
}

test('primera vez que se conoce el total: se establece en el libro (dato compartido)', async () => {
  const { db, library, bookUpdates, libraryUpdates } = buildDb({
    id: 'lib-1',
    userId: 'u1',
    bookId: 'book-1',
    status: ReadingStatus.READING,
    currentPage: 0,
    lastProgress: 0,
    progressNote: null,
    personalTotalPages: null,
    book: { totalPages: null },
  });
  const runtime = { prismaClient: db as never, now: () => new Date('2026-09-16T12:00:00Z') };

  const result = await actualizarProgresoLectura('Ada', 'Libro', 20, '', 100, 500, runtime);

  assert.deepEqual(result, { ok: true, progreso: 20, paginaActual: 100 });
  assert.deepEqual(bookUpdates, [{ totalPages: 500 }]);
  assert.equal(libraryUpdates[0].personalTotalPages, undefined);
  assert.equal(library.book.totalPages, 500);
});

test('el libro ya tiene total (otra edición): el ajuste se guarda como personal, nunca sobrescribe el libro', async () => {
  const { db, library, bookUpdates, libraryUpdates } = buildDb({
    id: 'lib-1',
    userId: 'u1',
    bookId: 'book-1',
    status: ReadingStatus.READING,
    currentPage: 0,
    lastProgress: 0,
    progressNote: null,
    personalTotalPages: null,
    book: { totalPages: 480 }, // edición canónica en español
  });
  const runtime = { prismaClient: db as never, now: () => new Date('2026-09-16T12:00:00Z') };

  const result = await actualizarProgresoLectura('Ada', 'Libro', 10, '', 60, 599, runtime);

  assert.deepEqual(result, { ok: true, progreso: 10, paginaActual: 60 });
  // El libro compartido no se toca...
  assert.deepEqual(bookUpdates, []);
  assert.equal(library.book.totalPages, 480);
  // ...el ajuste queda solo en la biblioteca de esta lectora.
  assert.equal(libraryUpdates[0].personalTotalPages, 599);
  assert.equal(library.personalTotalPages, 599);
});

test('mismo total que el del libro: no hace falta ajuste personal', async () => {
  const { bookUpdates, libraryUpdates, db } = buildDb({
    id: 'lib-1',
    userId: 'u1',
    bookId: 'book-1',
    status: ReadingStatus.READING,
    currentPage: 0,
    lastProgress: 0,
    progressNote: null,
    personalTotalPages: null,
    book: { totalPages: 480 },
  });
  const runtime = { prismaClient: db as never, now: () => new Date('2026-09-16T12:00:00Z') };

  await actualizarProgresoLectura('Ada', 'Libro', 10, '', 48, 480, runtime);

  assert.deepEqual(bookUpdates, []);
  assert.equal(libraryUpdates[0].personalTotalPages, undefined);
});

test('sin reenviar el total, usa el ajuste personal ya guardado (no el del libro)', async () => {
  const { db, library } = buildDb({
    id: 'lib-1',
    userId: 'u1',
    bookId: 'book-1',
    status: ReadingStatus.READING,
    currentPage: 0,
    lastProgress: 0,
    progressNote: null,
    personalTotalPages: 599,
    book: { totalPages: 480 },
  });
  const runtime = { prismaClient: db as never, now: () => new Date('2026-09-16T12:00:00Z') };

  // 300 de 599 (personal) = 50%, no 300 de 480 (63%).
  const result = await actualizarProgresoLectura('Ada', 'Libro', 0, '', 300, undefined, runtime);

  assert.deepEqual(result, { ok: true, progreso: 50, paginaActual: 300 });
  assert.equal(library.book.totalPages, 480);
});
