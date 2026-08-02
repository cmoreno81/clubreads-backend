import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const catalog = readFileSync('src/services/catalog.service.ts', 'utf8');

test('completar una saga añade el volumen a la biblioteca sin sobrescribirlo', () => {
  assert.match(
    catalog,
    /addSeriesCatalogVolume[\s\S]*prisma\.library\.upsert/,
  );
  assert.match(catalog, /update: \{\}/);
  assert.match(catalog, /status: ReadingStatus\.PENDING/);
  assert.match(catalog, /priority: Priority\.MEDIUM/);
});

test('vincular el volumen elimina una marca externa de esa posición', () => {
  assert.match(
    catalog,
    /prisma\.seriesBookOverride\.deleteMany\([\s\S]*requestedPosition/,
  );
});
