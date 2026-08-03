import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { ImportSource } from '@prisma/client';

import {
  buildImportPreview,
  compatibleAuthorScore,
  importRowIdempotencyKey,
  isAmbiguousBookmoryAuthor,
  parseImportRows,
} from '../src/services/goodreads-import.service.js';

const fixture = JSON.parse(await readFile(
  new URL('./fixtures/bookmory-real-cases.json', import.meta.url),
  'utf8',
));

const fakeDatabase = {
  book: {
    findMany: async () => fixture.catalog,
  },
};

test('Bookmory: S.T. Abby,Gema Pereira Silvestre encuentra Distracción y exige revisión', async () => {
  const [row] = parseImportRows([fixture.rows.distraccionAmbiguous]);
  const [preview] = await buildImportPreview(
    'silvia',
    [row],
    ImportSource.BOOKMORY,
    fakeDatabase as never,
  );
  assert.equal(isAmbiguousBookmoryAuthor(row.author), true);
  assert.equal(preview.accion, 'REVISAR');
  assert.deepEqual(preview.candidatos?.map(({ bookId }) => bookId), [
    'cmrd84m3700fnin50mg9ls2oz',
  ]);
});

test("Bookmory: O'Farrell, Maggie ordena Maggie O'Farrell como candidata sin unión automática", async () => {
  const [row] = parseImportRows([fixture.rows.hamnetInverted]);
  const [preview] = await buildImportPreview(
    'silvia',
    [row],
    ImportSource.BOOKMORY,
    fakeDatabase as never,
  );
  assert.ok(compatibleAuthorScore(row.author, "Maggie O'Farrell") > 0);
  assert.equal(preview.accion, 'REVISAR');
  assert.equal(preview.candidatos?.[0]?.bookId, 'cmrnrpfq7003i0pqmm9dks5nz');
});

test('la clave de idempotencia es estable por fuente y fila y distingue fuentes', () => {
  const [row] = parseImportRows([fixture.rows.distraccionAmbiguous]);
  assert.equal(
    importRowIdempotencyKey(ImportSource.BOOKMORY, row),
    importRowIdempotencyKey(ImportSource.BOOKMORY, row),
  );
  assert.notEqual(
    importRowIdempotencyKey(ImportSource.BOOKMORY, row),
    importRowIdempotencyKey(ImportSource.GOODREADS, row),
  );
});

test('la reimportación se protege antes de crear libro, biblioteca, reseña o finalización', async () => {
  const service = await readFile(
    new URL('../src/services/goodreads-import.service.ts', import.meta.url),
    'utf8',
  );
  const schema = await readFile(
    new URL('../prisma/schema.prisma', import.meta.url),
    'utf8',
  );
  assert.match(service, /const importedBefore = await tx\.importRowReceipt\.findUnique/);
  assert.match(service, /if \(importedBefore\) \{[\s\S]*continue;/);
  assert.match(service, /await tx\.importRowReceipt\.create/);
  assert.match(schema, /@@unique\(\[userId, source, idempotencyKey\]\)/);
});
