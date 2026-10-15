import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { calcularAfinidad } from '../src/services/amistades-descubrir.service.js';

const f = (bookId: string, rating: number | null, genero = 'Fantasía') => ({ bookId, rating, genero });

test('afinidad: libros en común, porcentaje sobre la biblioteca más pequeña y géneros', () => {
  const r = calcularAfinidad(
    [f('a', 4), f('b', 5), f('c', 3), f('d', 4, 'Romance')],
    [f('a', 4.5), f('b', 5), f('c', 3), f('x', 2)],
  );
  assert.equal(r.enComun, 3);
  assert.equal(r.afinidad, 75);
  assert.deepEqual(r.generos, ['Fantasía']);
  assert.equal(r.notasParecidas, true);
});

test('afinidad: notas muy distintas o pocas notas comunes no cuentan como «puntuáis parecido»', () => {
  assert.equal(calcularAfinidad([f('a', 5), f('b', 5), f('c', 5)], [f('a', 1), f('b', 2), f('c', 1)]).notasParecidas, false);
  assert.equal(calcularAfinidad([f('a', 5)], [f('a', 5)]).notasParecidas, false);
  assert.deepEqual(calcularAfinidad([], [f('a', 4)]), { enComun: 0, afinidad: 0, generos: [], notasParecidas: false });
});

test('las acciones nuevas de descubrir están enganchadas al router y los avisos en el catálogo', () => {
  const router = readFileSync('src/routes/api.router.ts', 'utf8');
  for (const a of ['afinidadAmigos', 'amigosDelLibro', 'resumenSemanalAmigos', 'pedirRecomendacion']) {
    assert.match(router, new RegExp(`case '${a}':`));
  }
  assert.match(router, /'pedirRecomendacion',/);
  assert.match(readFileSync('src/services/notifications.service.ts', 'utf8'), /NotificationType\.AMISTAD_PIDE_RECOMENDACION,/);
});
