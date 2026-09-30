import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const service = await readFile(
  new URL('../src/services/libro-por-id.service.ts', import.meta.url),
  'utf8',
);

function extractMap(source: string, marker: string) {
  const start = source.indexOf(marker);
  assert.ok(start >= 0, `no se encontró "${marker}"`);
  const end = source.indexOf('\n  });', start);
  assert.ok(end >= 0, `no se encontró el cierre de "${marker}"`);
  return source.slice(start, end);
}

test('clubFilter ya restringe a miembros del club cuando global es false', () => {
  assert.match(
    service,
    /clubFilter = global\s*\n\s*\? \{\}\s*\n\s*: \{ user: \{ clubMemberships: \{ some: \{ clubId: club\.id \} \} \} \};/,
  );
});

test('en modo global se precalcula el set de compañeras de club (cualquier club compartido)', () => {
  assert.match(
    service,
    /const clubmateIds = global \? await getClubmateIds\(user\.id\) : null;/,
  );
});

test('en modo club (global=false), mismoClub no depende del club activo actual', () => {
  for (const marker of [
    'const libros = libraryEntries.map((item) => {',
    'const finalizados = completions.map((item) => {',
  ]) {
    const bloque = extractMap(service, marker);
    // clubFilter ya garantiza pertenencia real al club cuando global=false,
    // así que mismoClub debe ser incondicionalmente true en ese caso.
    // En modo global, debe basarse en el set de compañeras de CUALQUIER
    // club (lista de amigas), no en el club activo en este momento.
    assert.match(
      bloque,
      /const mismoClub = global \? Boolean\(clubmateIds\?\.has\(item\.userId\)\) : true;/,
    );
  }
});
