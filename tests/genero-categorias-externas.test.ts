import assert from 'node:assert/strict';
import test from 'node:test';

import { generoDesdeCategoriasExternas as g } from '../src/utils/generos.utils.js';

test('«Fiction» y similares quedan como «Narrativa»; lo que no se reconoce, «Sin género»', () => {
  for (const c of ['Fiction', 'General', 'Literary Collections', 'Novel']) {
    assert.equal(g([c]), 'Narrativa', c);
  }
  for (const c of ['Boys', 'England', 'Anthology', '']) {
    assert.equal(g([c]), 'Sin género', c);
  }
  assert.equal(g([]), 'Sin género');
  assert.equal(g(undefined), 'Sin género');
});

test('las categorías con contenido se traducen a los géneros de la app', () => {
  assert.equal(g(['Fiction / Fantasy / Epic']), 'Fantasía');
  assert.equal(g(['Fantasy fiction']), 'Fantasía');
  assert.equal(g(['Fiction / Romance / Paranormal']), 'Paranormal');
  assert.equal(g(['Romance']), 'Romance');
  assert.equal(g(['Dark romance']), 'Dark Romance');
  assert.equal(g(['Science Fiction']), 'Ciencia ficción');
  assert.equal(g(['Fiction / Thrillers / Suspense']), 'Thriller');
  assert.equal(g(['Detective and mystery stories']), 'Novela negra');
  assert.equal(g(['Biography & Autobiography']), 'No ficción');
  assert.equal(g(['Business & Economics']), 'No ficción');
  assert.equal(g(['Dystopias']), 'Distopía');
  assert.equal(g(['Graphic novels']), 'Cómic');
});

test('el género de contenido manda sobre la edad, y la edad sola da Juvenil o Infantil', () => {
  assert.equal(g(['Juvenile Fiction / Fantasy & Magic']), 'Fantasía');
  assert.equal(g(['Young Adult Fiction / Romance']), 'Romance');
  assert.equal(g(['Juvenile Fiction']), 'Juvenil');
  assert.equal(g(['Young Adult Fiction']), 'Juvenil');
  assert.equal(g(["Children's stories"]), 'Infantil');
});

test('un género que ya es de la app se respeta aunque cambien las mayúsculas', () => {
  assert.equal(g(['ciencia ficción']), 'Ciencia ficción');
  assert.equal(g(['Novela Histórica']), 'Novela histórica');
  assert.equal(g(['dark academia']), 'Dark Academia');
  assert.equal(g(['Fantasía']), 'Fantasía');
  // «Narrativa» y «Grimdark» son géneros de la app.
  assert.equal(g(['narrativa']), 'Narrativa');
  assert.equal(g(['Grimdark']), 'Grimdark');
});

test('si hay varias categorías se elige la primera con contenido', () => {
  assert.equal(g(['Fiction', 'Fantasy', 'Romance']), 'Romance'); // Romance es más específico que Fantasía en las reglas
  assert.equal(g(['Fiction', 'General']), 'Narrativa');
});
