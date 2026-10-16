import assert from 'node:assert/strict';
import test from 'node:test';

import { normTitle, numerosCompatibles, titleHead, titleSimilarity } from '../src/services/store-link-sync.service.js';

test('«vol. 4» y «(novela) nº 04» se reconocen como el mismo tomo', () => {
  const a = normTitle('Evangelion Anima vol.4');
  const b = normTitle('EVANGELION ANIMA (NOVELA) Nº 04');
  assert.equal(a, 'evangelion anima 4');
  assert.equal(titleSimilarity(a, b) >= 0.92, true);
});

test('tomos distintos de una misma serie NO se confunden', () => {
  const t3 = normTitle('Evangelion Anima vol.3');
  const t4 = normTitle('Evangelion Anima nº 04');
  // Como texto se parecen mucho; lo que los separa es el número del tomo.
  assert.equal(numerosCompatibles(t3, t4), false);
  assert.equal(numerosCompatibles(normTitle('Evangelion Anima vol.4'), t4), true);
  assert.equal(numerosCompatibles('dune', 'dune 1'), true);
  assert.equal(numerosCompatibles('dune', 'dune 2'), false);
});

test('los números con ceros delante se normalizan', () => {
  assert.equal(normTitle('Serie nº 04'), 'serie 4');
  assert.equal(normTitle('Tomo 007'), '7');
  assert.equal(normTitle('Cien años de soledad'), 'cien anos de soledad');
});

test('el subtítulo largo solo se usa para cruzar, y solo si lo hay', () => {
  assert.equal(titleHead('Sin subtitulo'), '');
  const cabeza = titleHead('La mentira de Travis.: Comedia romántica, con proximidad forzosa');
  assert.equal(titleSimilarity(cabeza, normTitle('La mentira de Travis')) >= 0.92, true);
  assert.equal(titleHead('A: B'), '');
});

test('el cruce con el feed enlaza el tomo correcto y no el vecino', async () => {
  const { LinkMatcher, normTitle: nt, authorTokens, titleHead: th } = await import('../src/services/store-link-sync.service.js');
  const libro = (id: string, titulo: string) => ({
    id,
    nt: nt(titulo),
    nh: th(titulo) || undefined,
    authors: authorTokens('Khara'),
    isbn: '',
    wanted: new Set(['es']),
  });
  const m = new LinkMatcher([libro('v4', 'Evangelion Anima vol.4'), libro('v3', 'Evangelion Anima vol.3')]);
  const fila = (nombre: string, ean: string, id: string) => ({
    merchant_category: 'Libros > Cómic',
    stock_status: 'Disponibles',
    merchant_deep_link: `https://www.casadellibro.com/libro-x/${ean}/${id}`,
    ean,
    product_name: nombre,
    'BooksNL:author': 'Khara',
  });
  m.add(fila('EVANGELION ANIMA (NOVELA) Nº 04', '9791388101861', '18312576'));
  const enlaces = [...m.best.values()];
  assert.equal(enlaces.length, 1);
  assert.equal(enlaces[0]!.bookId, 'v4');
});
