import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveEditableDate } from '../src/services/checkin.service.js';

function daysAgo(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

function daysAhead(n: number): string {
  return daysAgo(-n);
}

test('sin fecha, usa hoy', () => {
  const result = resolveEditableDate();
  assert.deepEqual(result, { ok: true, date: daysAgo(0) });
});

test('acepta hoy y hasta 6 días atrás (ventana de 7 días)', () => {
  for (let n = 0; n <= 6; n++) {
    const result = resolveEditableDate(daysAgo(n));
    assert.deepEqual(result, { ok: true, date: daysAgo(n) });
  }
});

test('rechaza el día 7 hacia atrás y más allá (fuera de la ventana)', () => {
  const result = resolveEditableDate(daysAgo(7));
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.mensaje, /últimos 7 días/);

  const farther = resolveEditableDate(daysAgo(30));
  assert.equal(farther.ok, false);
});

test('rechaza fechas futuras', () => {
  const result = resolveEditableDate(daysAhead(1));
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.mensaje, /futuro/);
});

test('rechaza formatos y fechas inválidas', () => {
  for (const value of ['no-es-fecha', '2026-13-01', '2026-02-30', '26-01-01', '2026/01/01']) {
    const result = resolveEditableDate(value);
    assert.equal(result.ok, false, `esperaba rechazar "${value}"`);
  }
});
