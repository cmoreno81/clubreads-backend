import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  canonicalBookKey,
  normalizeBookIdentityText,
  normalizeBookIsbn,
} from '../src/services/book-identity.service.js';

const booksService = await readFile(new URL('../src/services/books.service.ts', import.meta.url), 'utf8');
const catalogService = await readFile(new URL('../src/services/catalog.service.ts', import.meta.url), 'utf8');
const goodreadsService = await readFile(new URL('../src/services/goodreads-import.service.ts', import.meta.url), 'utf8');
const mergeService = await readFile(new URL('../src/services/book-merge.service.ts', import.meta.url), 'utf8');
const migration = await readFile(
  new URL('../prisma/migrations/20260802190000_canonical_book_identity/migration.sql', import.meta.url),
  'utf8',
);

test('normaliza mayúsculas, tildes, puntuación y espacios', () => {
  assert.equal(normalizeBookIdentityText('  El   Fantasma de la ÓPERA  '), 'el fantasma de la opera');
  assert.equal(canonicalBookKey('Árbol  de  Humo', '  Denis Johnson '), 'arbol de humo::denis johnson');
});

test('el mismo título con autores distintos conserva identidades distintas', () => {
  assert.notEqual(
    canonicalBookKey('Siempre tuyo', 'Abby Jimenez'),
    canonicalBookKey('Siempre tuyo', 'Daniel Glattauer'),
  );
});

test('normaliza ISBN y descarta valores incompletos', () => {
  assert.equal(normalizeBookIsbn('978-84-19822-30-7'), '9788419822307');
  assert.equal(normalizeBookIsbn('0-306-40615-2'), '0306406152');
  assert.equal(normalizeBookIsbn('1234'), null);
});

test('PostgreSQL impone unicidad para ISBN y clave canónica activos', () => {
  assert.match(migration, /Book_active_normalizedIsbn_key/);
  assert.match(migration, /Book_active_canonicalKey_key/);
  assert.match(migration, /WHERE "deletedAt" IS NULL/);
  assert.match(migration, /BOOK_DUPLICATES_MUST_BE_RESOLVED/);
});

test('la creación concurrente bloquea, vuelve a consultar y solo después crea', () => {
  for (const source of [booksService, catalogService, goodreadsService]) {
    assert.match(source, /lockBookIdentity\(tx, identity\)/);
    assert.match(source, /findBookByIdentity\(tx, identity\)/);
  }
  assert.match(booksService, /library\.upsert/);
  assert.match(catalogService, /library\.upsert/);
  assert.match(booksService, /const concurrentBook = await findBookByIdentity\(tx, identity\)/);
});

test('editar excluye el propio libro y resuelve IDs fusionados', () => {
  assert.match(booksService, /resolveCanonicalBookId\(prisma, requestedBookId\)/);
  assert.match(booksService, /excludeBookId: bookId/);
  assert.match(booksService, /findBookByIdentity\(prisma/);
});

test('la fusión conserva relaciones, auditoría y redirección', () => {
  for (const relation of [
    'progressReaction',
    'readingCompletion',
    'review',
    'reading',
    'conversation',
    'clubvisionCandidate',
    'clubvisionVote',
    'clubvisionResult',
    'notification',
  ]) {
    assert.match(mergeService, new RegExp(`tx\\.${relation}`));
  }
  assert.match(mergeService, /bookMergeAudit\.create/);
  assert.match(mergeService, /bookRedirect\.upsert/);
  assert.match(mergeService, /deletedAt: new Date\(\)/);
  assert.match(mergeService, /TransactionIsolationLevel\.Serializable/);
  assert.match(mergeService, /equivalentCompletionKey/);
  assert.match(mergeService, /mostCompleteCompletion/);
  assert.match(mergeService, /readingCompletion\.deleteMany/);
});

test('una redirección puede resolverse en cadena y detecta ciclos', async () => {
  const { resolveCanonicalBookId } = await import('../src/services/book-identity.service.js');
  const redirects = new Map([['old', 'middle'], ['middle', 'canonical']]);
  const database = {
    bookRedirect: {
      findUnique: async ({ where }: { where: { oldBookId: string } }) => {
        const canonicalBookId = redirects.get(where.oldBookId);
        return canonicalBookId ? { canonicalBookId } : null;
      },
    },
  };
  assert.equal(await resolveCanonicalBookId(database as never, 'old'), 'canonical');
  redirects.set('canonical', 'old');
  await assert.rejects(() => resolveCanonicalBookId(database as never, 'old'), /BOOK_REDIRECT_CYCLE/);
});
