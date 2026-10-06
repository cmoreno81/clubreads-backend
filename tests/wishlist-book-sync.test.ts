import assert from 'node:assert/strict';
import test from 'node:test';

import {
  generoDesdeCategoria,
  nombreDeAutora,
} from '../src/services/wishlist-book-sync.service.js';
import {
  authorTokens,
  isbn13,
  LinkMatcher,
  normTitle,
} from '../src/services/store-link-sync.service.js';

const fila = (extra: Record<string, string> = {}) => ({
  merchant_category: 'Libros>Literatura>Terror>Cuentos de terror',
  product_name: 'Cuentos de terror',
  merchant_deep_link:
    'https://www.casadellibro.com/libro-cuentos-de-terror/9788467083927/18312487',
  ean: '9788467083927',
  'BooksNL:author': 'EDGAR ALLAN POE',
  stock_status: 'Preventa',
  merchant_image_url: 'https://imagessl7.casadellibro.com/a/l/t1/27/9788467083927.jpg',
  ...extra,
});

const deseo = (titulo: string, autora: string | null, isbn = '') => ({
  id: `${titulo}::${autora}`,
  nt: normTitle(titulo),
  authors: authorTokens(autora),
  isbn: isbn13(isbn),
  wanted: new Set(['es']),
});

test('un deseo se reconoce en el feed por título y autora, con imagen y categoría', () => {
  const m = new LinkMatcher([deseo('Cuentos de terror', 'Edgar Allan Poe')]);
  m.add(fila());
  const c = [...m.best.values()][0];
  assert.ok(c);
  assert.equal(c.format, 'PAPEL');
  assert.equal(c.ean, '9788467083927');
  assert.match(c.url, /libro-cuentos-de-terror\/9788467083927/);
  assert.match(c.imagenUrl ?? '', /9788467083927\.jpg$/);
  assert.match(c.categoria ?? '', /Terror/);
});

test('no se confunde con otro libro de otra autora ni con otra edición en otro idioma', () => {
  const m = new LinkMatcher([deseo('Cuentos de terror', 'Edgar Allan Poe')]);
  m.add(fila({ 'BooksNL:author': 'STEPHEN KING' }));
  m.add(fila({ product_name: 'Cuentos de terror (inglés)' }));
  assert.equal(m.best.size, 0);
});

test('sin autora solo se acepta si coincide el ISBN', () => {
  const sinIsbn = new LinkMatcher([deseo('Cuentos de terror', null)]);
  sinIsbn.add(fila());
  assert.equal(sinIsbn.best.size, 0);
  const conIsbn = new LinkMatcher([deseo('Cuentos de terror', null, '9788467083927')]);
  conIsbn.add(fila());
  assert.equal(conIsbn.best.size, 1);
});

test('el género sale de la categoría de la tienda', () => {
  assert.equal(generoDesdeCategoria('Libros>Literatura>Terror'), 'Terror');
  assert.equal(generoDesdeCategoria('Libros>Literatura>Novela romántica y erótica'), 'Romance');
  assert.equal(generoDesdeCategoria('Libros>Fantasía épica'), 'Fantasía');
  assert.equal(generoDesdeCategoria('Libros>Cocina'), 'Sin género');
  assert.equal(generoDesdeCategoria(undefined), 'Sin género');
});

test('las autoras del feed se escriben con mayúsculas y minúsculas normales', () => {
  assert.equal(nombreDeAutora('EDGAR ALLAN POE'), 'Edgar Allan Poe');
  assert.equal(nombreDeAutora('J.R.R. TOLKIEN'), 'J.R.R. Tolkien');
  assert.equal(nombreDeAutora('GABRIEL GARCIA DE LA CRUZ'), 'Gabriel Garcia de la Cruz');
  assert.equal(nombreDeAutora('Sarah J. Maas'), 'Sarah J. Maas');
});
