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

test('en modo club (global=false), mismoClub no depende del club activo actual', () => {
  for (const marker of [
    'const libros = libraryEntries.map((item) => {',
    'const finalizados = completions.map((item) => {',
  ]) {
    const bloque = extractMap(service, marker);
    // clubFilter ya garantiza pertenencia real al club cuando global=false,
    // así que mismoClub debe ser incondicionalmente true en ese caso — no
    // debe depender de si el club ACTIVO de esa persona coincide ahora
    // mismo (podría tener otro club seleccionado y seguir siendo compañera
    // de club nuestra).
    assert.match(
      bloque,
      /const mismoClub = global\s*\n\s*\? Boolean\(user\.activeClubId && item\.user\.activeClubId === user\.activeClubId\)\s*\n\s*: true;/,
    );
  }
});

test('el modo global sigue anonimizando por club activo, como antes', () => {
  assert.match(
    service,
    /global\s*\n\s*\? Boolean\(user\.activeClubId && item\.user\.activeClubId === user\.activeClubId\)/,
  );
});
