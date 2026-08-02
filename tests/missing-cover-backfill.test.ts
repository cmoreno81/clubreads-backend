import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const service = readFileSync('src/services/missing-cover-backfill.service.ts', 'utf8');
const coverService = readFileSync('src/services/book-cover.service.ts', 'utf8');
const server = readFileSync('src/server.ts', 'utf8');
const packageJson = readFileSync('package.json', 'utf8');

test('la tarea automática busca por ISBN, título y autor sin sobrescribir portadas', () => {
  assert.match(service, /findImportedBookCover\(\{/);
  assert.match(service, /author: book\.author\?\.name/);
  assert.match(service, /isbn: book\.isbn/);
  assert.match(service, /OR: \[\{ coverUrl: null \}, \{ coverUrl: '' \}\]/);
  assert.match(service, /prisma\.book\.updateMany/);
});

test('la tarea limita lotes, evita solapamientos y se repite diariamente', () => {
  assert.match(service, /const DEFAULT_BATCH_SIZE = 200/);
  assert.match(service, /if \(running\)/);
  assert.match(service, /setInterval\(execute/);
  assert.match(server, /startMissingCoverBackfill\(\)/);
});

test('los comandos de portadas usan el buscador reforzado', () => {
  assert.match(packageJson, /backfill-missing-covers\.ts/);
  assert.doesNotMatch(packageJson, /covers:apply[^\n]*find-book-covers\.ts/);
});

test('la búsqueda automática usa Google Books por ISBN y valida también la autoría', () => {
  assert.match(coverService, /searchGoogleBooks\(`isbn:\$\{isbn\}`\)/);
  assert.match(coverService, /normalizeIsbn\(identifier\.identifier/);
  assert.match(coverService, /sameAuthor\(identity\.author/);
  assert.match(coverService, /Open Library permanece disponible/);
});
