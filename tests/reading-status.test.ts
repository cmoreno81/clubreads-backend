import assert from 'node:assert/strict';
import {
  after,
  before,
  beforeEach,
  test,
} from 'node:test';
import { ReadingStatus } from '@prisma/client';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

let prisma: typeof import('../src/prisma.js').prisma;
let actualizarEstado:
  typeof import('../src/services/books.service.js').actualizarEstado;

const suffix = `${Date.now()}_${process.pid}`;
const userName = `reading_status_user_${suffix}`;
const genreName = `reading_status_genre_${suffix}`;
const bookTitle = `Reading status book ${suffix}`;

let userId = '';
let bookId = '';

async function resetReading(status = ReadingStatus.FINISHED) {
  await prisma.readingCompletion.deleteMany({
    where: { userId, bookId },
  });
  await prisma.review.deleteMany({ where: { userId, bookId } });
  await prisma.library.deleteMany({ where: { userId, bookId } });
  await prisma.library.create({
    data: {
      userId,
      bookId,
      status,
      priority: 'MEDIUM',
      startedAt: new Date('2026-01-01T12:00:00Z'),
      finishedAt:
        status === ReadingStatus.FINISHED
          ? new Date('2026-01-10T12:00:00Z')
          : null,
      pausedAt: new Date('2026-01-05T12:00:00Z'),
      pauseReason: 'Pausa anterior',
      lastProgress: 80,
      currentPage: 240,
      progressNote: 'Progreso anterior',
      progressUpdatedAt: new Date('2026-01-05T12:00:00Z'),
    },
  });
}

async function createCompletion(params?: {
  finishedAt?: Date;
  rating?: number;
  review?: string;
  isReread?: boolean;
}) {
  return prisma.readingCompletion.create({
    data: {
      userId,
      bookId,
      startedAt: new Date('2026-01-01T12:00:00Z'),
      finishedAt:
        params?.finishedAt ?? new Date('2026-01-10T12:00:00Z'),
      rating: params?.rating ?? 4,
      review: params?.review ?? 'Primera lectura',
      isReread: params?.isReread ?? false,
    },
  });
}

before(async () => {
  if (!testDatabaseUrl) return;

  process.env.DATABASE_URL = testDatabaseUrl;
  ({ prisma } = await import('../src/prisma.js'));
  ({ actualizarEstado } = await import(
    '../src/services/books.service.js'
  ));

  const genre = await prisma.genre.create({
    data: { name: genreName },
  });
  const user = await prisma.user.create({
    data: {
      name: userName,
      email: `${userName}@example.test`,
    },
  });
  const book = await prisma.book.create({
    data: {
      title: bookTitle,
      genreId: genre.id,
    },
  });

  userId = user.id;
  bookId = book.id;
});

beforeEach(async () => {
  if (!testDatabaseUrl) return;
  await resetReading();
});

after(async () => {
  if (!testDatabaseUrl || !prisma) return;

  await prisma.readingCompletion.deleteMany({ where: { userId, bookId } });
  await prisma.review.deleteMany({ where: { userId, bookId } });
  await prisma.library.deleteMany({ where: { userId, bookId } });
  await prisma.book.delete({ where: { id: bookId } });
  await prisma.user.delete({ where: { id: userId } });
  await prisma.genre.delete({ where: { name: genreName } });
  await prisma.$disconnect();
});

test(
  'FINISHED -> PENDING elimina la última finalización y limpia la lectura activa',
  { skip: !testDatabaseUrl },
  async () => {
    await createCompletion();
    await prisma.review.create({
      data: { userId, bookId, rating: 4, review: 'Primera lectura' },
    });

    const result = await actualizarEstado(
      userName,
      bookTitle,
      'PENDIENTE',
    );

    assert.equal(result.ok, true);
    const library = await prisma.library.findUniqueOrThrow({
      where: { userId_bookId: { userId, bookId } },
    });
    assert.equal(library.status, ReadingStatus.PENDING);
    assert.equal(library.startedAt, null);
    assert.equal(library.finishedAt, null);
    assert.equal(library.pausedAt, null);
    assert.equal(library.pauseReason, null);
    assert.equal(library.lastProgress, null);
    assert.equal(library.currentPage, null);
    assert.equal(library.progressNote, null);
    assert.equal(library.progressUpdatedAt, null);
    assert.equal(
      await prisma.readingCompletion.count({ where: { userId, bookId } }),
      0,
    );
    assert.equal(
      await prisma.review.findUnique({
        where: { userId_bookId: { userId, bookId } },
      }),
      null,
    );
  },
);

test(
  'FINISHED -> REREADING -> FINISHED conserva el historial y crea una relectura',
  { skip: !testDatabaseUrl },
  async () => {
    await createCompletion();

    await actualizarEstado(userName, bookTitle, 'RELECTURA');
    const rereading = await prisma.library.findUniqueOrThrow({
      where: { userId_bookId: { userId, bookId } },
    });
    assert.equal(rereading.status, ReadingStatus.REREADING);
    assert.equal(rereading.finishedAt, null);
    assert.equal(rereading.lastProgress, null);
    assert.equal(rereading.pausedAt, null);

    await actualizarEstado(
      userName,
      bookTitle,
      'FINALIZADO',
      '5',
      'Mejor en la relectura',
    );

    const completions = await prisma.readingCompletion.findMany({
      where: { userId, bookId },
      orderBy: { finishedAt: 'asc' },
    });
    assert.equal(completions.length, 2);
    assert.equal(completions[0].isReread, false);
    assert.equal(completions[1].isReread, true);
    assert.equal(completions[1].review, 'Mejor en la relectura');
  },
);

test(
  'FINISHED -> READING de una app antigua se convierte en REREADING',
  { skip: !testDatabaseUrl },
  async () => {
    await createCompletion();

    await actualizarEstado(userName, bookTitle, 'LEYENDO');

    const library = await prisma.library.findUniqueOrThrow({
      where: { userId_bookId: { userId, bookId } },
    });
    assert.equal(library.status, ReadingStatus.REREADING);
    assert.equal(
      await prisma.readingCompletion.count({ where: { userId, bookId } }),
      1,
    );
  },
);

test(
  'dos finalizaciones simultáneas crean una sola ReadingCompletion',
  { skip: !testDatabaseUrl },
  async () => {
    await resetReading(ReadingStatus.REREADING);
    await createCompletion();

    const results = await Promise.all([
      actualizarEstado(userName, bookTitle, 'FINALIZADO', '4', 'Una'),
      actualizarEstado(userName, bookTitle, 'FINALIZADO', '4', 'Una'),
    ]);

    assert.deepEqual(
      results.map((result) => result.ok),
      [true, true],
    );
    assert.equal(
      await prisma.readingCompletion.count({ where: { userId, bookId } }),
      2,
    );
  },
);

test(
  'corregir una finalización restaura la Review anterior y después la elimina',
  { skip: !testDatabaseUrl },
  async () => {
    await createCompletion({
      finishedAt: new Date('2026-01-10T12:00:00Z'),
      rating: 3.5,
      review: 'Reseña anterior',
    });
    await createCompletion({
      finishedAt: new Date('2026-02-10T12:00:00Z'),
      rating: 5,
      review: 'Reseña corregida',
      isReread: true,
    });
    await prisma.review.create({
      data: {
        userId,
        bookId,
        rating: 5,
        review: 'Reseña corregida',
      },
    });

    await actualizarEstado(userName, bookTitle, 'PENDIENTE');
    const restored = await prisma.review.findUniqueOrThrow({
      where: { userId_bookId: { userId, bookId } },
    });
    assert.equal(restored.rating, 3.5);
    assert.equal(restored.review, 'Reseña anterior');

    await prisma.library.update({
      where: { userId_bookId: { userId, bookId } },
      data: { status: ReadingStatus.FINISHED },
    });
    await actualizarEstado(userName, bookTitle, 'PENDIENTE');
    assert.equal(
      await prisma.review.findUnique({
        where: { userId_bookId: { userId, bookId } },
      }),
      null,
    );
  },
);
