import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { normalizeGoodreadsUrl } from '../src/services/books.service.js';

const booksService = await readFile(
  new URL('../src/services/books.service.ts', import.meta.url),
  'utf8',
);

test('editar metadatos compartidos invalida todas las cachés de biblioteca', () => {
  assert.match(
    booksService,
    /function invalidateAllLibraryCaches\(\) \{\s*invalidatePrefix\('libros:'\);\s*invalidatePrefix\('finalizados:'\);\s*\}/,
  );
  assert.match(
    booksService,
    /const actualizado = editResult\.updated!;\s*invalidateAllLibraryCaches\(\);\s*return \{\s*ok: true,/,
  );
});

test('editarLibro devuelve el goodreadsUrl actualizado por Prisma', () => {
  assert.match(
    booksService,
    /const actualizado = editResult\.updated!;[\s\S]*?libro: \{[\s\S]*?goodreadsUrl: actualizado\.goodreadsUrl \?\? '',/,
  );
});

test('normaliza espacios y puntuación accidental al final de Goodreads', () => {
  assert.equal(
    normalizeGoodreadsUrl(
      ' https://www.goodreads.com/book/show/223950662-amor-en-pr-stamo, ',
    ),
    'https://www.goodreads.com/book/show/223950662-amor-en-pr-stamo',
  );
  assert.equal(normalizeGoodreadsUrl(''), '');
});
