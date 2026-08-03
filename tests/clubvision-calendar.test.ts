import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  getClubvisionCalendarFor,
  getClubvisionNoticeMomentFor,
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

test('el cambio del día 3 al 4 se calcula en Europe/Madrid', () => {
  const before = getClubvisionCalendarFor(new Date('2026-08-03T21:59:59.000Z'));
  const after = getClubvisionCalendarFor(new Date('2026-08-03T22:00:00.000Z'));
  assert.equal(before.day, 3);
  assert.equal(getClubvisionStage(before.day, false), 'RESULTADOS');
  assert.equal(after.day, 4);
  assert.equal(getClubvisionStage(after.day, false), 'LECTURA');
  assert.equal(after.edition, before.edition);
});

test('la zona de Madrid no adelanta el mes durante la víspera', () => {
  const calendar = getClubvisionCalendarFor(
    new Date('2026-07-31T21:59:59Z'),
  );

  assert.deepEqual(calendar, { edition: '2026-07', day: 31 });
});

test('la víspera anuncia la apertura de la edición siguiente', () => {
  assert.deepEqual(
    getClubvisionNoticeMomentFor(
      new Date('2026-07-31T10:00:00+02:00'),
    ),
    { type: 'APERTURA', edition: '2026-08' },
  );
});

test('los avisos distinguen votación, gala y días sin evento', () => {
  assert.equal(
    getClubvisionNoticeMomentFor(
      new Date('2026-08-01T10:00:00+02:00'),
    )?.type,
    'VOTACION',
  );
  assert.equal(
    getClubvisionNoticeMomentFor(
      new Date('2026-08-03T10:00:00+02:00'),
    )?.type,
    'GALA',
  );
  assert.equal(
    getClubvisionNoticeMomentFor(
      new Date('2026-08-04T10:00:00+02:00'),
    ),
    null,
  );
});
