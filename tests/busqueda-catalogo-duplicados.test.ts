import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { identityKeys } from '../src/services/catalog.service.js';
import { extraTitleKeys } from '../src/services/goodreads-import.service.js';

const claves = (titulo: string, autor: string) => identityKeys({ isbn: '', titulo, autores: [autor] }, extraTitleKeys);
const comparten = (a: string[], b: string[]) => a.some((k) => b.includes(k));

test('un resultado externo con «Serie N - Título» se empareja con el libro que ya está en ClubReads', () => {
  const local = claves('En llamas', 'Suzanne Collins');
  assert.ok(comparten(local, claves('Los Juegos del Hambre 2 - En llamas', 'Suzanne Collins')));
  assert.ok(comparten(claves('Los juegos del hambre', 'Suzanne Collins'), claves('Los Juegos del Hambre 1 - Los Juegos del Hambre', 'Suzanne Collins')));
});

test('no empareja libros distintos, otra autoría ni otros tomos de la serie', () => {
  const local = claves('En llamas', 'Suzanne Collins');
  assert.equal(comparten(local, claves('El dios en llamas', 'R. F. Kuang')), false);
  assert.equal(comparten(local, claves('Los Juegos del Hambre 3 - Sinsajo', 'Suzanne Collins')), false);
  assert.equal(comparten(local, claves('En llamas', 'Otra Persona')), false);
});

test('la búsqueda devuelve cuánta gente tiene ya cada libro de ClubReads', () => {
  const src = readFileSync('src/services/catalog.service.ts', 'utf8');
  assert.match(src, /lectores: book\.library\.length/);
  assert.match(src, /identityKeys\(book, extraTitleKeys\)/);
});
