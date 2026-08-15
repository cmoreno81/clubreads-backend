import assert from 'node:assert/strict';
import test from 'node:test';

import { ReadingStatus } from '@prisma/client';
import { actualizarProgresoLectura } from '../src/services/books.service.js';

test('REREADING persiste 21, 31 y permite corregir de 31 a 21 sin páginas negativas', async () => {
  const library = {
    id: 'library-1',
    userId: 'user-1',
    bookId: 'book-1',
    status: ReadingStatus.REREADING,
    currentPage: 0 as number | null,
    lastProgress: 0 as number | null,
    progressNote: null as string | null,
    book: { totalPages: 100 },
  };
  let pagesRead = 0;
  const sessionDeltas: number[] = [];
  const db = {
    library: {
      findFirst: async () => ({ ...library, book: { ...library.book } }),
      update: async ({ data }: { data: { currentPage: number; lastProgress: number } }) => {
        library.currentPage = data.currentPage;
        library.lastProgress = data.lastProgress;
        return library;
      },
    },
    progressReaction: { deleteMany: async () => ({ count: 0 }) },
    book: { update: async () => library.book },
    readingSession: {
      upsert: async ({ create }: { create: { pagesRead: number } }) => {
        sessionDeltas.push(create.pagesRead);
        pagesRead += create.pagesRead;
        return { pagesRead };
      },
    },
    $transaction: async (operations: Array<Promise<unknown>>) => Promise.all(operations),
  };
  const runtime = {
    prismaClient: db as never,
    now: () => new Date('2026-08-15T12:00:00.000Z'),
  };

  const page21 = await actualizarProgresoLectura('Ada', 'Libro', 21, '', 21, undefined, runtime);
  assert.deepEqual(page21, { ok: true, progreso: 21, paginaActual: 21 });
  assert.equal(library.currentPage, 21);

  const page31 = await actualizarProgresoLectura('Ada', 'Libro', 31, '', 31, undefined, runtime);
  assert.deepEqual(page31, { ok: true, progreso: 31, paginaActual: 31 });
  assert.equal(library.currentPage, 31);

  const corrected = await actualizarProgresoLectura('Ada', 'Libro', 21, '', 21, undefined, runtime);
  assert.deepEqual(corrected, { ok: true, progreso: 21, paginaActual: 21 });
  assert.equal(library.currentPage, 21);
  assert.equal(library.lastProgress, 21);
  assert.deepEqual(sessionDeltas, [21, 10]);
  assert.equal(pagesRead, 31);
});

test('las páginas 0 y total son válidas y superar el total se rechaza', async () => {
  const library = {
    id: 'library-1', userId: 'user-1', bookId: 'book-1', currentPage: 10,
    progressNote: null, book: { totalPages: 100 },
  };
  const db = {
    library: {
      findFirst: async () => library,
      update: async ({ data }: { data: { currentPage: number } }) => {
        library.currentPage = data.currentPage;
        return library;
      },
    },
    progressReaction: { deleteMany: async () => ({ count: 0 }) },
    book: { update: async () => library.book },
    readingSession: { upsert: async () => ({}) },
    $transaction: async (operations: Array<Promise<unknown>>) => Promise.all(operations),
  };
  const runtime = { prismaClient: db as never };

  assert.equal((await actualizarProgresoLectura('Ada', 'Libro', 0, '', 0, undefined, runtime)).ok, true);
  assert.equal(library.currentPage, 0);
  assert.equal((await actualizarProgresoLectura('Ada', 'Libro', 100, '', 100, undefined, runtime)).ok, true);
  assert.equal(library.currentPage, 100);
  const invalid = await actualizarProgresoLectura('Ada', 'Libro', 101, '', 101, undefined, runtime);
  assert.equal(invalid.ok, false);
  assert.match(invalid.mensaje ?? '', /entre 0 y 100/);
  assert.equal(library.currentPage, 100);
});
