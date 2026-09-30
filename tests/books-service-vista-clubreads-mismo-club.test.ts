import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const booksService = await readFile(
  new URL('../src/services/books.service.ts', import.meta.url),
  'utf8',
);
const clubContextService = await readFile(
  new URL('../src/services/club-context.service.ts', import.meta.url),
  'utf8',
);

function extractFunction(source: string, marker: string) {
  const start = source.indexOf(marker);
  assert.ok(start >= 0, `no se encontró "${marker}"`);
  const end = source.indexOf('\n}', start);
  assert.ok(end >= 0, `no se encontró el cierre de "${marker}"`);
  return source.slice(start, end);
}

test('getClubmateIds calcula compañeras de CUALQUIER club compartido, no solo el activo', () => {
  assert.match(
    clubContextService,
    /export async function getClubmateIds\(userId: string\): Promise<Set<string>> \{/,
  );
  assert.match(
    clubContextService,
    /clubMember\.findMany\(\{\s*where: \{ userId \},\s*select: \{ clubId: true \}/,
  );
  assert.match(
    clubContextService,
    /clubMember\.findMany\(\{\s*where: \{ clubId: \{ in: clubIds \} \},\s*select: \{ userId: true \}/,
  );
});

test('_getLibrosGlobal usa clubmateIds en vez de comparar activeClubId', () => {
  const bloque = extractFunction(booksService, 'async function _getLibrosGlobal(usuario: string) {');
  assert.match(bloque, /const clubmateIds = user \? await getClubmateIds\(user\.id\) : new Set<string>\(\);/);
  assert.match(bloque, /const mismoClub = clubmateIds\.has\(item\.userId\);/);
  assert.doesNotMatch(bloque, /activeClubId/);
});

test('_getLibrosFinalizadosTodosGlobal usa clubmateIds en vez de comparar activeClubId', () => {
  const bloque = extractFunction(
    booksService,
    'async function _getLibrosFinalizadosTodosGlobal(usuario: string) {',
  );
  assert.match(bloque, /const clubmateIds = user \? await getClubmateIds\(user\.id\) : new Set<string>\(\);/);
  assert.match(bloque, /const mismoClub = clubmateIds\.has\(item\.userId\);/);
  assert.doesNotMatch(bloque, /activeClubId/);
});
