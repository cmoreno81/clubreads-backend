import assert from 'node:assert/strict';
import test from 'node:test';

import { deduplicateLatestBooks } from '../src/services/general-dashboard.service.js';

test('últimas incorporaciones colapsa títulos equivalentes y prefiere la copia con portada', () => {
  const books = [
    { id: 'new-no-cover', title: 'Distracción', coverUrl: null, author: { name: 'S.T. Abby, Gema Pereira Silvestre' } },
    { id: 'other', title: 'Otro libro', coverUrl: 'other.jpg', author: { name: 'Otra Autora' } },
    { id: 'canonical', title: '  DISTRACCION ', coverUrl: 'cover.jpg', author: { name: 'S. T. Abby' } },
  ];

  assert.deepEqual(
    deduplicateLatestBooks(books, 10).map(({ id }) => id),
    ['canonical', 'other'],
  );
});

test('últimas incorporaciones aplica el límite después de deduplicar', () => {
  const books = [
    { id: 'duplicate-new', title: 'La reina que fue y será', coverUrl: null, author: { name: 'Paula Lafferty, Mariola Cortés-Cros' } },
    { id: 'duplicate-cover', title: 'La reina que fue y sera', coverUrl: 'queen.jpg', author: { name: 'Paula Lafferty' } },
    { id: 'second', title: 'Segundo', coverUrl: null, author: { name: 'Autora Dos' } },
    { id: 'third', title: 'Tercero', coverUrl: null, author: { name: 'Autora Tres' } },
  ];

  assert.deepEqual(
    deduplicateLatestBooks(books, 2).map(({ id }) => id),
    ['duplicate-cover', 'second'],
  );
});

test('no colapsa obras homónimas de autoras distintas', () => {
  const books = [
    { id: 'abby', title: 'Siempre tuyo', coverUrl: 'abby.jpg', author: { name: 'Abby Jimenez' } },
    { id: 'daniel', title: 'Siempre tuyo', coverUrl: 'daniel.jpg', author: { name: 'Daniel Glattauer' } },
  ];

  assert.deepEqual(deduplicateLatestBooks(books).map(({ id }) => id), ['abby', 'daniel']);
});
