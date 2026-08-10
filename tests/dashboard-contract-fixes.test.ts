import assert from 'node:assert/strict';
import test from 'node:test';
import { ReadingStatus } from '@prisma/client';

import {
  compareContinueSeries,
  completedRating,
  isCanonicalActiveReading,
  shouldShowContinueSeries,
} from '../src/services/general-dashboard.service.js';
import { ratingToFlutter } from '../src/utils/rating.utils.js';
import { activityTimestamp } from '../src/utils/activity-timestamp.js';

test('Mes lector incluye exclusivamente el estado canónico READING', () => {
  assert.equal(isCanonicalActiveReading(ReadingStatus.READING), true);
  assert.equal(isCanonicalActiveReading(ReadingStatus.PAUSED), false);
  assert.equal(isCanonicalActiveReading(ReadingStatus.FINISHED), false);
  assert.equal(isCanonicalActiveReading(ReadingStatus.REREADING), false);
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
