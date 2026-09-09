import assert from 'node:assert/strict';
import test from 'node:test';

import {
  resolveEditableDate,
  levelForPagesRead,
  PAGE_RANGE_REPRESENTATIVE,
} from '../src/services/checkin.service.js';

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

test('acepta cualquier día pasado, sin límite de ventana', () => {
  for (const n of [0, 1, 6, 7, 30, 365, 3650]) {
    const result = resolveEditableDate(daysAgo(n));
    assert.deepEqual(result, { ok: true, date: daysAgo(n) });
  }
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

test('levelForPagesRead sigue los tramos 0-50/50-75/75-100/100+', () => {
  assert.equal(levelForPagesRead(0), 0);
  assert.equal(levelForPagesRead(1), 1);
  assert.equal(levelForPagesRead(50), 1);
  assert.equal(levelForPagesRead(51), 2);
  assert.equal(levelForPagesRead(75), 2);
  assert.equal(levelForPagesRead(76), 3);
  assert.equal(levelForPagesRead(100), 3);
  assert.equal(levelForPagesRead(101), 4);
  assert.equal(levelForPagesRead(500), 4);
});

test('los valores representativos de cada tramo caen en su propio nivel', () => {
  assert.equal(levelForPagesRead(PAGE_RANGE_REPRESENTATIVE.HASTA_50), 1);
  assert.equal(levelForPagesRead(PAGE_RANGE_REPRESENTATIVE.DE_50_A_75), 2);
  assert.equal(levelForPagesRead(PAGE_RANGE_REPRESENTATIVE.DE_75_A_100), 3);
  assert.equal(levelForPagesRead(PAGE_RANGE_REPRESENTATIVE.MAS_DE_100), 4);
});
