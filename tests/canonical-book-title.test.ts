import assert from 'node:assert/strict';
import test from 'node:test';

import { canonicalBookTitle } from '../src/services/catalog.service.js';

test('quita marcadores de edición (deluxe, especial, etc.)', () => {
  assert.equal(canonicalBookTitle('The Hunger Games (Deluxe Edition)'), 'the hunger games');
  assert.equal(canonicalBookTitle('Trono de Cristal (Edición especial)'), 'trono de cristal');
});

test('quita el sufijo de saga/posición al final del título', () => {
  assert.equal(
    canonicalBookTitle('The Hunger Games (The Hunger Games, #1)'),
    'the hunger games',
  );
  assert.equal(
    canonicalBookTitle('Catching Fire (The Hunger Games, #2)'),
    'catching fire',
  );
  assert.equal(
    canonicalBookTitle('Trono de cristal (Trono de Cristal 1)'),
    'trono de cristal',
  );
});

test('acepta los formatos "Book N" y "Libro N" (número o palabra)', () => {
  assert.equal(
    canonicalBookTitle('Catching Fire (Deluxe Edition) (Hunger Games, Book Two)'),
    'catching fire',
  );
  assert.equal(
    canonicalBookTitle('Mockingjay (Hunger Games, Book 3)'),
    'mockingjay',
  );
  assert.equal(
    canonicalBookTitle('Reina de sombras (Trono de Cristal, Libro 4)'),
    'reina de sombras',
  );
});

test('las dos variantes de un mismo libro colapsan a la misma clave', () => {
  assert.equal(
    canonicalBookTitle('The Hunger Games (The Hunger Games, #1)'),
    canonicalBookTitle('The Hunger Games (Deluxe Edition)'),
  );
  assert.equal(
    canonicalBookTitle('Catching Fire (The Hunger Games, #2)'),
    canonicalBookTitle('Catching Fire (Deluxe Edition) (Hunger Games, Book Two)'),
  );
});

test('no toca paréntesis que no son sufijo de saga', () => {
  assert.equal(
    canonicalBookTitle('El nombre de la rosa (novela)'),
    'el nombre de la rosa (novela)',
  );
  assert.equal(canonicalBookTitle('It'), 'it');
});
