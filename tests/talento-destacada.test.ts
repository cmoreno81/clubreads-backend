import assert from 'node:assert/strict';
import test from 'node:test';

import {
  elegirAutoraDeLaSemana,
  etiquetaSemana,
  indiceSemana,
} from '../src/services/talento-emergente-destacada.service.js';

const libros = (n: number, fijada?: number) =>
  Array.from({ length: n }, (_, i) => ({
    id: `b${i}`,
    talentFeaturedWeek: i === fijada ? etiquetaSemana('2026-10-12') : null,
  }));

test('las semanas empiezan el lunes y avanzan de siete en siete días', () => {
  assert.equal(indiceSemana('2026-10-12'), indiceSemana('2026-10-18')); // lunes a domingo
  assert.equal(indiceSemana('2026-10-19'), indiceSemana('2026-10-12') + 1);
  assert.equal(etiquetaSemana('2026-01-05'), 'S0000');
});

test('sin libros no hay autora de la semana', () => {
  assert.equal(elegirAutoraDeLaSemana([], '2026-10-12'), null);
});

test('rota cada semana entre los libros con sello', () => {
  const l = libros(3);
  const semana1 = elegirAutoraDeLaSemana(l, '2026-10-12')!.id;
  const semana2 = elegirAutoraDeLaSemana(l, '2026-10-19')!.id;
  const semana3 = elegirAutoraDeLaSemana(l, '2026-10-26')!.id;
  const semana4 = elegirAutoraDeLaSemana(l, '2026-11-02')!.id;
  assert.equal(new Set([semana1, semana2, semana3]).size, 3);
  assert.equal(semana4, semana1);
  // Mismo resultado todos los días de la semana.
  assert.equal(elegirAutoraDeLaSemana(l, '2026-10-18')!.id, semana1);
});

test('una autora fijada a mano gana a la rotación, solo esa semana', () => {
  const l = libros(3, 2);
  assert.equal(elegirAutoraDeLaSemana(l, '2026-10-14')!.id, 'b2');
  assert.notEqual(elegirAutoraDeLaSemana(l, '2026-10-21')!.id, undefined);
});
