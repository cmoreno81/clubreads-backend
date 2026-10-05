import assert from 'node:assert/strict';
import test from 'node:test';

import { StoreFormat } from '@prisma/client';

import { extractSiblingLinks } from '../src/services/store-link-page.service.js';

// Fragmentos reales de la ficha de Yesteryear: sus otros formatos y, además,
// ebooks y audiolibros de OTROS libros (recomendaciones).
const FICHA = `
<a href="/ebook-yesteryear-ebook/9791387596422/18157100" class="x">eBook <div>
<a href="/audiolibro-yesteryear-audiolibro/9791387596514/18228658" class="x">Audiolibro</a>
{"url":"/ebook-los-huerfanos-ebook/9788408324768/18281715","price":"9.95"}
<a href="/audiolibro-enamorate-de-ti-audiolibro/9788408304333/17137973">otro</a>
<a href="/ebook-una-familia-moderna-ebook/9788401033803/18298898">otro</a>
`;
const PAPEL = 'https://www.casadellibro.com/libro-yesteryear/9791387596415/17984312';

test('encuentra el ebook y el audiolibro del mismo libro', () => {
  const links = extractSiblingLinks(FICHA, PAPEL);
  const byFormat = new Map(links.map((l) => [l.format, l]));
  assert.equal(links.length, 2);
  assert.equal(
    byFormat.get(StoreFormat.EBOOK)?.url,
    'https://www.casadellibro.com/ebook-yesteryear-ebook/9791387596422/18157100',
  );
  assert.equal(byFormat.get(StoreFormat.EBOOK)?.ean, '9791387596422');
  assert.equal(
    byFormat.get(StoreFormat.AUDIO)?.url,
    'https://www.casadellibro.com/audiolibro-yesteryear-audiolibro/9791387596514/18228658',
  );
});

test('ignora los ebooks y audiolibros de otros libros', () => {
  const soloOtros = `
    <a href="/ebook-los-huerfanos-ebook/9788408324768/18281715">x</a>
    <a href="/audiolibro-enamorate-de-ti-audiolibro/9788408304333/17137973">y</a>`;
  assert.deepEqual(extractSiblingLinks(soloOtros, PAPEL), []);
});

test('no confunde un libro con otro cuyo nombre solo empieza igual', () => {
  const html = '<a href="/ebook-it-capitulo-dos-ebook/9788401033803/1">x</a>';
  assert.deepEqual(
    extractSiblingLinks(html, 'https://www.casadellibro.com/libro-it/9788401033800/2'),
    [],
  );
});

test('acepta URLs absolutas y no repite el mismo formato', () => {
  const html = `
    <a href="https://www.casadellibro.com/ebook-a-la-deriva-contigo-ebook/9788491299851/17415392">x</a>
    <a href="/ebook-a-la-deriva-contigo-ebook/9788491299999/1">repetido</a>`;
  const links = extractSiblingLinks(
    html,
    'https://www.casadellibro.com/libro-a-la-deriva-contigo/9788491299844/17140817',
  );
  assert.equal(links.length, 1);
  assert.equal(links[0]?.ean, '9788491299851');
});

test('una ficha sin otros formatos no devuelve nada', () => {
  assert.deepEqual(extractSiblingLinks('<html></html>', PAPEL), []);
});
