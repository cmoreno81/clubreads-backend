import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ReadingStatus } from '@prisma/client';

import { actualizarEstado } from '../src/services/books.service.js';

type Completion = {
  id: string; userId: string; bookId: string; startedAt: Date | null;
  finishedAt: Date; createdAt: Date; isReread: boolean;
  rating: number | null; review: string | null; readingFormat: null;
};

function fixture(status = ReadingStatus.FINISHED) {
  const user = { id: 'user', name: 'Lectora' };
  const book = {
    id: 'book', title: 'Libro', genreId: 'genre', seriesId: null,
    seriesOrder: null, standalone: true, goodreadsUrl: null, coverUrl: null,
    isbn: null, publicationYear: null, totalPages: 300,
  };
  const state: {
    library: any;
    completions: Completion[];
    review: null | { rating: number; review: string | null; deletedAt?: null };
  } = {
    library: {
      id: 'library', userId: user.id, bookId: book.id, status,
      priority: 'MEDIUM', readingFormat: null,
      startedAt: new Date('2026-01-01T12:00:00Z'),
      finishedAt: status === ReadingStatus.FINISHED ? new Date('2026-01-10T12:00:00Z') : null,
      pausedAt: new Date('2026-01-05T12:00:00Z'), pauseReason: 'Pausa anterior',
      lastProgress: 80, currentPage: 240, progressNote: 'Progreso anterior',
      progressUpdatedAt: new Date('2026-01-05T12:00:00Z'),
    },
    completions: [],
    review: null,
  };
  let sequence = 0;
  let transactionQueue = Promise.resolve();
  const matches = (value: Completion, where: any) =>
    (!where.userId || value.userId === where.userId) &&
    (!where.bookId || value.bookId === where.bookId);
  const tx = {
    $queryRaw: async () => [],
    library: {
      // Prisma devuelve un objeto materializado; no una referencia viva que
      // cambie cuando el mismo registro se actualiza después en la transacción.
      findUnique: async () => ({ ...state.library }),
      upsert: async ({ update }: any) => Object.assign(state.library, update),
    },
    readingCompletion: {
      count: async ({ where }: any) => state.completions.filter((item) => matches(item, where)).length,
      findFirst: async ({ where }: any) => [...state.completions]
        .filter((item) => matches(item, where))
        .sort((a, b) => b.finishedAt.getTime() - a.finishedAt.getTime() || b.id.localeCompare(a.id))[0] ?? null,
      delete: async ({ where }: any) => {
        const index = state.completions.findIndex(({ id }) => id === where.id);
        return state.completions.splice(index, 1)[0];
      },
      create: async ({ data }: any) => {
        const item: Completion = {
          id: `completion-${++sequence}`, createdAt: new Date(),
          readingFormat: null, ...data,
        };
        state.completions.push(item);
        return item;
      },
    },
    review: {
      upsert: async ({ update, create }: any) => {
        state.review = state.review ? { ...state.review, ...update } : { ...create };
        return state.review;
      },
      deleteMany: async () => { const count = state.review ? 1 : 0; state.review = null; return { count }; },
    },
    clubMember: { findMany: async () => [] },
  };
  const client = {
    user: { findUnique: async () => user },
    book: { findMany: async () => [book] },
    clubMember: { findMany: async () => [] },
    $transaction: async (operation: (client: typeof tx) => Promise<unknown>) => {
      const result = transactionQueue.then(() => operation(tx));
      transactionQueue = result.then(() => undefined, () => undefined);
      return result;
    },
  } as any;
  const addCompletion = (params: Partial<Completion> = {}) => {
    const item: Completion = {
      id: `completion-${++sequence}`, userId: user.id, bookId: book.id,
      startedAt: new Date('2026-01-01T12:00:00Z'),
      finishedAt: new Date('2026-01-10T12:00:00Z'), createdAt: new Date(),
      isReread: false, rating: 4, review: 'Primera lectura', readingFormat: null,
      ...params,
    };
    state.completions.push(item);
    return item;
  };
  const update = (
    usuario: string,
    libro: string,
    estado: string,
    valoracion?: string,
    reflexion?: string,
  ) => actualizarEstado(
    usuario, libro, estado, valoracion, reflexion,
    undefined, undefined, undefined, undefined,
    { client, notifyStarted: async () => {}, notifyFinished: async () => {} },
  );
  return { state, addCompletion, update };
}

test('FINISHED -> PENDING elimina la última finalización y limpia la lectura activa', async () => {
  const { state, addCompletion, update } = fixture();
  addCompletion();
  state.review = { rating: 4, review: 'Primera lectura' };
  assert.equal((await update('Lectora', 'Libro', 'PENDIENTE')).ok, true);
  assert.equal(state.library.status, ReadingStatus.PENDING);
  for (const field of ['startedAt', 'finishedAt', 'pausedAt', 'pauseReason', 'lastProgress', 'currentPage', 'progressNote', 'progressUpdatedAt']) {
    assert.equal(state.library[field], null, field);
  }
  assert.equal(state.completions.length, 0);
  assert.equal(state.review, null);
});

test('FINISHED -> REREADING -> FINISHED conserva historial y crea relectura', async () => {
  const { state, addCompletion, update } = fixture();
  addCompletion();
  await update('Lectora', 'Libro', 'RELECTURA');
  assert.equal(state.library.status, ReadingStatus.REREADING);
  assert.equal(state.completions.length, 1);
  await update('Lectora', 'Libro', 'FINALIZADO', '5', 'Mejor en la relectura');
  assert.equal(state.completions.length, 2);
  assert.equal(state.completions[1]?.isReread, true);
  assert.equal(state.completions[1]?.review, 'Mejor en la relectura');
});

test('FINISHED -> READING de cliente antiguo se convierte en REREADING', async () => {
  const { state, addCompletion, update } = fixture();
  addCompletion();
  await update('Lectora', 'Libro', 'LEYENDO');
  assert.equal(state.library.status, ReadingStatus.REREADING);
  assert.equal(state.completions.length, 1);
});

test('dos finalizaciones simultáneas crean una sola finalización nueva', async () => {
  const { state, addCompletion, update } = fixture(ReadingStatus.REREADING);
  addCompletion();
  const results = await Promise.all([
    update('Lectora', 'Libro', 'FINALIZADO', '4', 'Una'),
    update('Lectora', 'Libro', 'FINALIZADO', '4', 'Una'),
  ]);
  assert.deepEqual(results.map(({ ok }) => ok), [true, true]);
  assert.equal(state.completions.length, 2);
});

test('corregir finalizaciones restaura la reseña anterior y después la elimina', async () => {
  const { state, addCompletion, update } = fixture();
  addCompletion({ finishedAt: new Date('2026-01-10T12:00:00Z'), rating: 3.5, review: 'Reseña anterior' });
  addCompletion({ finishedAt: new Date('2026-02-10T12:00:00Z'), rating: 5, review: 'Reseña corregida', isReread: true });
  state.review = { rating: 5, review: 'Reseña corregida' };
  await update('Lectora', 'Libro', 'PENDIENTE');
  assert.deepEqual(state.review, { rating: 3.5, review: 'Reseña anterior', deletedAt: null });
  state.library.status = ReadingStatus.FINISHED;
  await update('Lectora', 'Libro', 'PENDIENTE');
  assert.equal(state.review, null);
  assert.equal(state.completions.length, 0);
});
