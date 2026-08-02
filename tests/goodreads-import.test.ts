import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  importAuthorIdentity,
  importTitleVariants,
  isRatedFinishedGoodreadsRow,
  normalizeGoodreadsReview,
} from '../src/services/goodreads-import.service.js';

const service = await readFile(
  new URL('../src/services/goodreads-import.service.ts', import.meta.url),
  'utf8',
);
const router = await readFile(
  new URL('../src/routes/api.router.ts', import.meta.url),
  'utf8',
);
const authorBackfill = await readFile(
  new URL('../scripts/backfill-book-authors.ts', import.meta.url),
  'utf8',
);
const booksService = await readFile(
  new URL('../src/services/books.service.ts', import.meta.url),
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
    /if \(item\.accion === 'PROTEGIDO'\)[\s\S]*fillEmptyPersonalReview[\s\S]*continue;/,
  );
  assert.doesNotMatch(
    service,
    /library\.update\([\s\S]*priority:[\s\S]*row/,
  );
});

test('una reimportación recupera reseñas vacías sin sustituir las de ClubReads', () => {
  assert.match(service, /if \(!importedReview \|\| row\.rating === null\) return false/);
  assert.match(service, /else if \(!existingReview\.review\?\.trim\(\)\)/);
  assert.match(service, /data: \{ review: importedReview \}/);
  assert.match(service, /if \(completion && !completion\.review\?\.trim\(\)\)/);
  assert.doesNotMatch(
    service,
    /review\.update\([\s\S]{0,250}rating: row\.rating/,
  );
  assert.match(service, /resenasRecuperadas: result\.restoredReviews/);
});

test('convierte los saltos HTML de las reseñas en saltos de línea reales', () => {
  assert.equal(
    normalizeGoodreadsReview('Primer párrafo<br>Segundo<br />Tercero<BR/>Cuarto'),
    'Primer párrafo\nSegundo\nTercero\nCuarto',
  );
  assert.equal(
    normalizeGoodreadsReview('Primero&lt;br&gt;Segundo\r\nTercero'),
    'Primero\nSegundo\nTercero',
  );
});

test('solo admite libros finalizados y valorados', () => {
  assert.equal(
    isRatedFinishedGoodreadsRow({ exclusiveShelf: 'read', rating: 5 }),
    true,
  );
  assert.equal(
    isRatedFinishedGoodreadsRow({ exclusiveShelf: 'read', rating: null }),
    false,
  );
  assert.equal(
    isRatedFinishedGoodreadsRow({ exclusiveShelf: 'to-read', rating: 5 }),
    false,
  );
  assert.equal(
    isRatedFinishedGoodreadsRow({
      exclusiveShelf: 'currently-reading',
      rating: 4,
    }),
    false,
  );
  assert.match(
    service,
    /const eligibleRows = rows\.filter\(isRatedFinishedGoodreadsRow\)/,
  );
  assert.match(
    service,
    /const rows = parsedRows\.filter\(isRatedFinishedGoodreadsRow\)/,
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
  assert.match(service, /if \(!book\.authorId && row\.author\.trim\(\)\)/);
  assert.match(service, /data\.author = \{ connect: \{ id: author\.id \} \}/);
});

test('un título antiguo sin autor no une dos obras homónimas', () => {
  assert.match(service, /titleHasSeveralImportedAuthors/);
  assert.match(
    service,
    /El título existe sin autor y el archivo contiene varias obras homónimas/,
  );
  assert.match(authorBackfill, /hasCompetingAuthor/);
  assert.match(authorBackfill, /!hasCompetingAuthor/);
});

test('el autor puede completarse manualmente sin borrar el existente', () => {
  assert.match(booksService, /data\.autor \|\| data\.author/);
  assert.match(
    booksService,
    /authorId: suppliedAuthor\?\.id \?\? actual\.authorId/,
  );
});

test('la confirmación completa se ejecuta dentro de una transacción', () => {
  assert.match(service, /prisma\.\$transaction\(async \(tx\) =>/);
  assert.match(service, /await addPersonalData\(tx,/);
  assert.match(service, /timeout: IMPORT_TRANSACTION_TIMEOUT_MS/);
  assert.match(service, /const IMPORT_TRANSACTION_TIMEOUT_MS = 120_000/);
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
  assert.ok(
    importTitleVariants('Mentiras (Serie Mindf*ck #4)')
      .includes('mentiras'),
  );
  assert.ok(
    importTitleVariants('Ángel escarlata (Serie Mindf*ck, #3)')
      .includes('angel escarlata'),
  );
  assert.deepEqual(importTitleVariants('Yesteryear'), ['yesteryear']);
});

test('tolera signos y espacios diferentes en los nombres de autor', () => {
  assert.equal(importAuthorIdentity('S.T. Abby'), 's t abby');
  assert.equal(importAuthorIdentity('S. T. Abby'), 's t abby');
});
