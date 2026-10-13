import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { baseTitleNormalized } from '../src/services/book-identity.service.js';
import { canonicalBookTitle } from '../src/services/catalog.service.js';
import { extraTitleKeys, findNearExactBook } from '../src/services/goodreads-import.service.js';

const claves = (t: string) => {
  const c = canonicalBookTitle(t);
  return [c, ...extraTitleKeys(c)];
};

test('«Serie N - Título» se reconoce como el título de verdad (Los Juegos del Hambre)', () => {
  for (const [corto, largo] of [
    ['Los juegos del hambre', 'Los Juegos del Hambre 1 - Los Juegos del Hambre'],
    ['En llamas', 'Los Juegos del Hambre 2 - En llamas'],
    ['Sinsajo', 'Los Juegos del Hambre 3 - Sinsajo'],
  ] as const) {
    assert.ok(claves(corto).some((k) => claves(largo).includes(k)), `${corto} ≠ ${largo}`);
    assert.equal(baseTitleNormalized(largo), baseTitleNormalized(corto));
  }
});

test('no confunde títulos que solo comparten la serie o llevan números propios', () => {
  assert.notEqual(baseTitleNormalized('Los Juegos del Hambre 2 - En llamas'), baseTitleNormalized('Sinsajo'));
  assert.equal(baseTitleNormalized('Fahrenheit 451'), 'fahrenheit 451');
  assert.equal(baseTitleNormalized('Hasta que caiga la luna (La Caída Lunar 1)'), 'hasta que caiga la luna');
  assert.equal(baseTitleNormalized('Divergente 1 - Divergente'), 'divergente');
  // Los dos tomos de la misma serie NO comparten clave entre sí.
  const t2 = claves('Los Juegos del Hambre 2 - En llamas');
  const t3 = claves('Los Juegos del Hambre 3 - Sinsajo');
  assert.ok(!t2.some((k) => k !== '' && t3.includes(k)));
});

test('al añadir un libro del catálogo externo se reutiliza la ficha existente (misma autoría)', async () => {
  const candidatos = [
    { id: 'b-en-llamas', title: 'En llamas', deletedAt: null, author: { name: 'Suzanne Collins' }, _count: { library: 3 } },
    { id: 'b-sinsajo', title: 'Sinsajo', deletedAt: null, author: { name: 'Suzanne Collins' }, _count: { library: 3 } },
  ];
  const db: any = { book: { findMany: async () => candidatos } };
  const r: any = await findNearExactBook(db, { title: 'Los Juegos del Hambre 2 - En llamas', authorName: 'Suzanne Collins' });
  assert.equal(r?.id, 'b-en-llamas');
  const s: any = await findNearExactBook(db, { title: 'Los Juegos del Hambre 3 - Sinsajo', authorName: 'Suzanne Collins' });
  assert.equal(s?.id, 'b-sinsajo');
  // Sin autoría no se arriesga a unir nada.
  assert.equal(await findNearExactBook(db, { title: 'Los Juegos del Hambre 2 - En llamas', authorName: '' }), null);
});

test('la vía «añadir desde el catálogo» comprueba el casi-duplicado antes de crear', () => {
  const src = readFileSync('src/services/catalog.service.ts', 'utf8');
  assert.equal((src.match(/findNearExactBook/g) ?? []).length >= 2, true);
});
