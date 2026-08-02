import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { ReadingStatus } from '@prisma/client';
import { validateReadingTransitionInput } from '../src/utils/reading-transition.utils.js';

const catalog = readFileSync('src/services/catalog.service.ts', 'utf8');

test('PENDING vincula y crea Library sin sobrescribir una relación existente', () => {
  assert.match(
    catalog,
    /addSeriesCatalogVolume[\s\S]*prisma\.\$transaction\(async \(tx\) =>/,
  );
  assert.match(catalog, /statusWasProvided \? \{ status: effectiveStatus, \.\.\.statusDates \} : \{\}/);
  assert.match(catalog, /requestedStatus \?\? existingLibrary\?\.status \?\? ReadingStatus\.PENDING/);
  assert.match(catalog, /priority: Priority\.MEDIUM/);
});

test('READING acepta formato y fecha de inicio dentro de la misma transacción', () => {
  const parsed = validateReadingTransitionInput({
    status: ReadingStatus.READING,
    fechaInicio: '2025-03-04',
    now: new Date('2026-01-01T00:00:00Z'),
  });
  assert.equal(parsed.ok, true);
  if (parsed.ok) assert.equal(parsed.startDate?.toISOString(), '2025-03-04T12:00:00.000Z');
  assert.match(catalog, /effectiveStatus === ReadingStatus\.READING/);
  assert.match(catalog, /formatWasProvided \? \{ readingFormat: requestedFormat \} : \{\}/);
});

test('FINISHED exige valoración y fechas válidas y crea ReadingCompletion', () => {
  assert.deepEqual(
    validateReadingTransitionInput({ status: ReadingStatus.FINISHED, valoracion: '' }),
    { ok: false, mensaje: 'Los libros finalizados necesitan una valoración mayor que 0' },
  );
  const parsed = validateReadingTransitionInput({
    status: ReadingStatus.FINISHED,
    valoracion: '4,5',
    fechaInicio: '2025-04-10',
    fechaFin: '2025-04-01',
    now: new Date('2026-01-01T00:00:00Z'),
  });
  assert.deepEqual(parsed, {
    ok: false,
    mensaje: 'La fecha de finalización no puede ser anterior al inicio',
  });
  assert.match(catalog, /tx\.readingCompletion\.create/);
  assert.match(catalog, /rating: transition\.rating as number/);
  assert.match(catalog, /tx\.review\.upsert/);
});

test('vincular el volumen elimina una marca externa de esa posición', () => {
  assert.match(
    catalog,
    /tx\.seriesBookOverride\.deleteMany\([\s\S]*requestedPosition/,
  );
});
