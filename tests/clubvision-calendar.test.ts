import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  getClubvisionCalendarFor,
  getClubvisionStage,
} from '../src/utils/clubvision-calendar.js';

test('el día 1 abre la votación con el mes de Madrid', () => {
  const calendar = getClubvisionCalendarFor(
    new Date('2026-08-01T00:30:00+02:00'),
  );

  assert.deepEqual(calendar, { edition: '2026-08', day: 1 });
  assert.equal(getClubvisionStage(calendar.day, false), 'VOTACION');
});

test('los nueve votos publican resultados antes del día 3', () => {
  assert.equal(getClubvisionStage(2, true), 'RESULTADOS');
});

test('el día 3 publica la gala aunque falten votos', () => {
  assert.equal(getClubvisionStage(3, false), 'RESULTADOS');
});

test('el día 4 activa la lectura ganadora', () => {
  assert.equal(getClubvisionStage(4, false), 'LECTURA');
});

test('la zona de Madrid no adelanta el mes durante la víspera', () => {
  const calendar = getClubvisionCalendarFor(
    new Date('2026-07-31T21:59:59Z'),
  );

  assert.deepEqual(calendar, { edition: '2026-07', day: 31 });
});
