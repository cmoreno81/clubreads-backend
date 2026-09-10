import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SEASON_EPOCH,
  SEASON_LENGTH_DAYS,
  bonusPorRacha,
  currentSeasonNumber,
  daysBetween,
  puntosPorLibro,
  puntosPorPaginas,
  seasonEndsAt,
  seasonNumberForDate,
  seasonWindow,
  tzMidnightUtc,
} from '../src/services/ligas.service.js';

// ── Temporadas ──────────────────────────────────────────────────────────────

test('la temporada 0 empieza en el epoch de lanzamiento', () => {
  assert.equal(seasonNumberForDate(SEASON_EPOCH), 0);
  assert.deepEqual(seasonWindow(0).startDate, SEASON_EPOCH);
});

test('cada temporada dura exactamente 14 días', () => {
  const w0 = seasonWindow(0);
  const w1 = seasonWindow(1);
  assert.equal(daysBetween(w0.startDate, w0.endDate), SEASON_LENGTH_DAYS);
  assert.equal(w0.endDate, w1.startDate);
  assert.equal(daysBetween(w0.startDate, w1.startDate), SEASON_LENGTH_DAYS);
});

test('los días caen en la temporada correcta', () => {
  const { startDate } = seasonWindow(3);
  assert.equal(seasonNumberForDate(startDate), 3);
  // Último día de la temporada 3
  const ultimo = seasonWindow(3).endDate;
  assert.equal(seasonNumberForDate(ultimo), 4); // endDate es exclusivo
});

test('las fechas anteriores al lanzamiento no tienen temporada', () => {
  const antes = seasonWindow(-1).startDate; // 14 días antes del epoch
  assert.equal(seasonNumberForDate(antes), -1);
});

test('currentSeasonNumber nunca es negativo', () => {
  assert.ok(currentSeasonNumber(new Date('2000-01-01T00:00:00Z')) >= 0);
});

test('seasonEndsAt coincide con la medianoche de Madrid del fin de ventana', () => {
  const fin = seasonEndsAt(0);
  assert.deepEqual(fin, tzMidnightUtc(seasonWindow(0).endDate));
  // Madrid en septiembre está en CEST (UTC+2): medianoche local = 22:00 UTC.
  assert.equal(fin.getUTCHours(), 22);
});

// ── Puntos ─────────────────────────────────────────────────────────────────

test('puntosPorPaginas: 1 punto por cada 20 páginas, tope 10', () => {
  assert.equal(puntosPorPaginas(0), 0);
  assert.equal(puntosPorPaginas(19), 0);
  assert.equal(puntosPorPaginas(20), 1);
  assert.equal(puntosPorPaginas(59), 2);
  assert.equal(puntosPorPaginas(200), 10);
  assert.equal(puntosPorPaginas(5_000), 10);
});

test('bonusPorRacha: longitud de la racha, tope 15', () => {
  assert.equal(bonusPorRacha(0), 0);
  assert.equal(bonusPorRacha(1), 1);
  assert.equal(bonusPorRacha(15), 15);
  assert.equal(bonusPorRacha(40), 15);
});

test('puntosPorLibro: 40 normal, 20 relectura o libro corto', () => {
  assert.equal(puntosPorLibro({ isReread: false, totalPages: 320 }), 40);
  assert.equal(puntosPorLibro({ isReread: false, totalPages: null }), 40);
  assert.equal(puntosPorLibro({ isReread: true, totalPages: 320 }), 20);
  assert.equal(puntosPorLibro({ isReread: false, totalPages: 30 }), 20);
  assert.equal(puntosPorLibro({ isReread: false, totalPages: 49 }), 20);
  assert.equal(puntosPorLibro({ isReread: false, totalPages: 50 }), 40);
});
