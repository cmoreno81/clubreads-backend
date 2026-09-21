import assert from 'node:assert/strict';
import test from 'node:test';

import { calcularRachaClub } from '../src/services/club-streak.service.js';

test('sin ningún día activo, la racha es 0 y no hay último día', () => {
  const r = calcularRachaClub(new Set(), '2026-09-21');
  assert.deepEqual(r, { racha: 0, ultimoDiaActivo: null });
});

test('con actividad hoy, cuenta hoy como parte de la racha', () => {
  const dates = new Set(['2026-09-21', '2026-09-20', '2026-09-19']);
  const r = calcularRachaClub(dates, '2026-09-21');
  assert.equal(r.racha, 3);
  assert.equal(r.ultimoDiaActivo, '2026-09-21');
});

test('sin actividad hoy pero sí ayer, la racha sigue viva (no rota hasta medianoche)', () => {
  const dates = new Set(['2026-09-20', '2026-09-19']);
  const r = calcularRachaClub(dates, '2026-09-21');
  assert.equal(r.racha, 2);
});

test('sin actividad ni hoy ni ayer, la racha está rota (0) aunque hubiera actividad antes', () => {
  const dates = new Set(['2026-09-15', '2026-09-14']);
  const r = calcularRachaClub(dates, '2026-09-21');
  assert.equal(r.racha, 0);
  // pero el último día activo se sigue informando (el club "duerme", no ha muerto)
  assert.equal(r.ultimoDiaActivo, '2026-09-15');
});

test('un hueco en medio corta la racha en ese punto', () => {
  const dates = new Set(['2026-09-21', '2026-09-20', '2026-09-18']); // falta el 19
  const r = calcularRachaClub(dates, '2026-09-21');
  assert.equal(r.racha, 2); // solo 21 y 20
});

test('basta con que UNA persona del club haya estado activa ese día', () => {
  // Simula: solo Ana activa el 21, solo Bea activa el 20 — el club sigue vivo.
  const activasDeAna = new Set(['2026-09-21']);
  const activasDeBea = new Set(['2026-09-20']);
  const unionDelClub = new Set([...activasDeAna, ...activasDeBea]);
  const r = calcularRachaClub(unionDelClub, '2026-09-21');
  assert.equal(r.racha, 2);
});
