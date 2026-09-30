import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const service = await readFile(
  new URL('../src/services/readings.service.ts', import.meta.url),
  'utf8',
);

function extractFunction(source: string, name: string) {
  const start = source.indexOf(`export async function ${name}(`);
  assert.ok(start >= 0, `no se encontró ${name}`);
  const end = source.indexOf('\nexport ', start + 1);
  return source.slice(start, end === -1 ? undefined : end);
}

test('las conversaciones de un libro se buscan en todos los clubes de la usuaria, no solo el activo', () => {
  assert.match(
    service,
    /async function clubIdsParaConversaciones\(/,
  );
  assert.match(service, /clubMember\.findMany\(\{\s*where: \{ userId: user\.id \}/);

  // getConversacionesLibro y getConversacionesLibroPage deben filtrar por
  // la lista de clubIds, nunca por el club.id activo en solitario.
  for (const nombre of ['getConversacionesLibro', 'getConversacionesLibroPage']) {
    const cuerpo = extractFunction(service, nombre);
    assert.match(cuerpo, /clubIdsParaConversaciones\(club, user\)/);
    assert.match(cuerpo, /clubId: \{ in: clubIds \}/);
    assert.doesNotMatch(cuerpo, /clubId: club\.id/);
  }
});

test('sin usuaria (procesos automáticos) sigue usando el club por defecto', () => {
  assert.match(
    service,
    /if \(!user\) return \[club\.id\];/,
  );
});

test('si la usuaria no tiene membresías, no se queda sin buscar en ningún club', () => {
  assert.match(
    service,
    /return clubIds\.length > 0 \? clubIds : \[club\.id\];/,
  );
});

test('cada conversación devuelve de qué club es, para poder mostrarlo y entrar en el correcto', () => {
  for (const nombre of ['getConversacionesLibro', 'getConversacionesLibroPage']) {
    const cuerpo = extractFunction(service, nombre);
    assert.match(cuerpo, /club: \{ select: \{ id: true, name: true \} \}/);
    assert.match(cuerpo, /clubId: reading\.club\.id,/);
    assert.match(cuerpo, /clubNombre: reading\.club\.name,/);
  }
});
