import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { importTitleVariants } from '../src/services/goodreads-import.service.js';

const service = await readFile(
  new URL('../src/services/goodreads-import.service.ts', import.meta.url),
  'utf8',
);
const router = await readFile(
  new URL('../src/routes/api.router.ts', import.meta.url),
  'utf8',
);

test('la importación de Goodreads exige autenticación y solo admite POST', () => {
  assert.match(router, /'previsualizarImportacionGoodreads'/);
  assert.match(router, /'confirmarImportacionGoodreads'/);
  assert.match(
    router,
    /case 'previsualizarImportacionGoodreads':[\s\S]*requireAuthentication/,
  );
  assert.match(
    router,
    /case 'confirmarImportacionGoodreads':[\s\S]*requireAuthentication/,
  );
});

test('los libros existentes protegen los datos personales de ClubReads', () => {
  assert.match(service, /accion: 'PROTEGIDO'/);
  assert.match(
    service,
    /if \(item\.accion === 'PROTEGIDO'\)[\s\S]*continue;/,
  );
  assert.doesNotMatch(
    service,
    /library\.update\([\s\S]*priority:[\s\S]*row/,
  );
});

test('solo se completan metadatos vacíos del libro compartido', () => {
  assert.match(service, /if \(!book\.isbn && isbn\) data\.isbn = isbn/);
  assert.match(
    service,
    /if \(!book\.totalPages && row\.pages\) data\.totalPages = row\.pages/,
  );
  assert.match(
    service,
    /if \(!book\.publicationYear && row\.publicationYear\)/,
  );
});

test('la confirmación completa se ejecuta dentro de una transacción', () => {
  assert.match(service, /prisma\.\$transaction\(async \(tx\) =>/);
  assert.match(service, /await addPersonalData\(tx,/);
});

test('una lectura sin fecha usa una fecha histórica y nunca el año actual', () => {
  assert.match(
    service,
    /row\.dateAdded\.getUTCFullYear\(\) < now\.getUTCFullYear\(\)/,
  );
  assert.match(
    service,
    /Date\.UTC\(now\.getUTCFullYear\(\) - 1, 11, 31, 12\)/,
  );
  assert.match(service, /if \(row\.dateRead\) return row\.dateRead/);
});

test('las portadas vacías se completan sin sustituir las existentes', () => {
  assert.match(service, /findImportedBookCover/);
  assert.match(service, /if \(!book \|\| book\.coverUrl\?\.trim\(\)\) continue/);
  assert.match(
    service,
    /OR: \[\{ coverUrl: null \}, \{ coverUrl: '' \}\]/,
  );
  assert.match(service, /void enrichMissingCovers/);
});

test('reconoce títulos de Goodreads con la saga y el volumen entre paréntesis', () => {
  assert.deepEqual(
    importTitleVariants('Magnolia Parks (Magnolia Parks Universe, #1)'),
    [
      'magnolia parks (magnolia parks universe, #1)',
      'magnolia parks',
    ],
  );
  assert.ok(
    importTitleVariants('Dungeon Crawler Carl (Dungeon Crawler Carl, #1)')
      .includes('dungeon crawler carl'),
  );
  assert.ok(
    importTitleVariants('Nuncanoche (Crónicas de Nuncanoche #1)')
      .includes('nuncanoche'),
  );
});
