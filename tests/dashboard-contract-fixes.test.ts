import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { ReadingStatus } from '@prisma/client';

import {
  compareContinueSeries,
  completedRating,
  isCanonicalActiveReading,
  buildCalendarReadings,
  shouldShowContinueSeries,
} from '../src/services/general-dashboard.service.js';
import { ratingToFlutter } from '../src/utils/rating.utils.js';
import { activityTimestamp } from '../src/utils/activity-timestamp.js';

const dashboardService = await readFile(
  new URL('../src/services/general-dashboard.service.ts', import.meta.url),
  'utf8',
);

test('Leyendo ahora y la consulta mensual incluyen lecturas y relecturas', () => {
  assert.match(
    dashboardService,
    /library: \{\s*where: \{\s*status: \{\s*in: \[ReadingStatus\.READING, ReadingStatus\.REREADING\]/,
  );
  assert.match(
    dashboardService,
    /const \[\s*user,[\s\S]*?prisma\.library\.findMany\(\{\s*where: \{\s*userId,\s*startedAt: \{ lt: end \},\s*OR: \[\s*\{ finishedAt: \{ gte: start \} \},\s*\{\s*status: \{\s*in: \[ReadingStatus\.READING, ReadingStatus\.REREADING\]/,
  );
});

test('Mes lector considera READING y REREADING como tramos activos', () => {
  assert.equal(isCanonicalActiveReading(ReadingStatus.READING), true);
  assert.equal(isCanonicalActiveReading(ReadingStatus.REREADING), true);
  assert.equal(isCanonicalActiveReading(ReadingStatus.PAUSED), false);
  assert.equal(isCanonicalActiveReading(ReadingStatus.PENDING), false);
  assert.equal(isCanonicalActiveReading(ReadingStatus.FINISHED), false);
  assert.equal(isCanonicalActiveReading(ReadingStatus.ABANDONED), false);

  const book = { id: 'book-1', title: 'Libro', coverUrl: null };
  const statuses = [
    ReadingStatus.READING,
    ReadingStatus.REREADING,
    ReadingStatus.PAUSED,
    ReadingStatus.PENDING,
    ReadingStatus.FINISHED,
    ReadingStatus.ABANDONED,
  ];
  const readings = buildCalendarReadings(
    [],
    statuses.map((status) => ({
      id: status,
      bookId: `${book.id}-${status}`,
      book: { ...book, id: `${book.id}-${status}` },
      startedAt: new Date('2026-08-01T00:00:00.000Z'),
      status,
    })),
    new Date('2026-08-15T00:00:00.000Z'),
  );
  assert.deepEqual(readings.map(({ id }) => id), [
    `library:${ReadingStatus.READING}`,
    `library:${ReadingStatus.REREADING}`,
  ]);
});

test('una relectura finalizada no se duplica como tramo activo', () => {
  const start = new Date('2026-08-03T00:00:00.000Z');
  const end = new Date('2026-08-10T00:00:00.000Z');
  const now = new Date('2026-08-15T00:00:00.000Z');
  const book = { id: 'book-1', title: 'Libro', coverUrl: 'cover.jpg' };
  const readings = buildCalendarReadings(
    [{ id: 'completion-1', bookId: book.id, book, startedAt: start, finishedAt: end, isReread: true }],
    [{ id: 'library-1', bookId: book.id, book, startedAt: start, status: ReadingStatus.REREADING }],
    now,
  );
  assert.equal(readings.length, 1);
  assert.equal(readings[0]?.id, 'completion:completion-1');
  assert.equal(readings[0]?.bookId, 'book-1');
  assert.equal(readings[0]?.coverUrl, 'cover.jpg');
});

test('lectura original y relectura conservan periodos diferentes', () => {
  const originalStart = new Date('2026-08-01T00:00:00.000Z');
  const originalEnd = new Date('2026-08-05T00:00:00.000Z');
  const rereadStart = new Date('2026-08-12T00:00:00.000Z');
  const now = new Date('2026-08-15T00:00:00.000Z');
  const book = { id: 'book-1', title: 'Libro', coverUrl: null };
  const readings = buildCalendarReadings(
    [{ id: 'original', bookId: book.id, book, startedAt: originalStart, finishedAt: originalEnd, isReread: false }],
    [{ id: 'reread', bookId: book.id, book, startedAt: rereadStart, status: ReadingStatus.REREADING }],
    now,
  );
  assert.equal(readings.length, 2);
  assert.deepEqual(readings.map(({ fechaInicio }) => fechaInicio), [
    originalStart.toISOString(), rereadStart.toISOString(),
  ]);
  assert.ok(readings.every(({ bookId }) => bookId === 'book-1'));
  assert.ok(readings.every(({ titulo }) => titulo === 'Libro'));
  assert.ok(readings.every(({ coverUrl }) => coverUrl === ''));
});

test('libro finalizado conserva estrellas y no inventa valoración ausente', () => {
  assert.equal(ratingToFlutter(completedRating(4.5)), '⭐⭐⭐⭐½');
  assert.equal(completedRating(null), null);
  assert.equal(ratingToFlutter(completedRating(null)), '');
});

test('saga abandonada y completada sin siguiente volumen quedan excluidas', () => {
  assert.equal(shouldShowContinueSeries({ id: 'a', nombre: 'A', estado: 'EN_CURSO', siguiente: {}, hasAbandonedVolume: true }), false);
  assert.equal(shouldShowContinueSeries({ id: 'b', nombre: 'B', estado: 'EN_CURSO', siguiente: null }), false);
  assert.equal(shouldShowContinueSeries({ id: 'c', nombre: 'C', estado: 'PENDIENTE', siguiente: {} }), true);
});

test('sagas en curso preceden a pendientes con desempate estable por nombre e id', () => {
  const rows = [
    { id: '2', nombre: 'Beta', estado: 'PENDIENTE' as const, siguiente: {} },
    { id: '3', nombre: 'Alfa', estado: 'EN_CURSO' as const, siguiente: {} },
    { id: '2', nombre: 'Alfa', estado: 'PENDIENTE' as const, siguiente: {} },
    { id: '1', nombre: 'Alfa', estado: 'PENDIENTE' as const, siguiente: {} },
  ].sort(compareContinueSeries);
  assert.deepEqual(rows.map(({ id, estado }) => [id, estado]), [
    ['3', 'EN_CURSO'], ['1', 'PENDIENTE'], ['2', 'PENDIENTE'], ['2', 'PENDIENTE'],
  ]);
});

test('última actividad devuelve timestamp ISO completo o null', () => {
  assert.equal(activityTimestamp(new Date('2026-08-03T14:05:06.789Z')), '2026-08-03T14:05:06.789Z');
  assert.equal(activityTimestamp(null), null);
});
