import assert from 'node:assert/strict';
import test from 'node:test';
import { listaGeneros, normalizarGenerosExtra } from '../src/utils/generos.utils.js';

test('normalizarGenerosExtra recorta, quita duplicados y limita a 2', () => {
  assert.deepEqual(
    normalizarGenerosExtra([' Juvenil ', 'fantasía', 'Romance', 'Terror'], 'Fantasía'),
    ['Juvenil', 'Romance'],
  );
});

test('normalizarGenerosExtra tolera entradas raras', () => {
  assert.deepEqual(normalizarGenerosExtra(undefined, 'Fantasía'), []);
  assert.deepEqual(normalizarGenerosExtra('Juvenil', 'Fantasía'), []);
  assert.deepEqual(normalizarGenerosExtra(['', null, '  '], 'Fantasía'), []);
});

test('listaGeneros pone el principal primero', () => {
  assert.deepEqual(
    listaGeneros({ genre: { name: 'Fantasía' }, extraGenres: ['Juvenil'] }),
    ['Fantasía', 'Juvenil'],
  );
  assert.deepEqual(listaGeneros({ genre: { name: 'Fantasía' }, extraGenres: null }), ['Fantasía']);
});
