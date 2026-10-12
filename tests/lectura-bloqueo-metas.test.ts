import assert from 'node:assert/strict';
import test from 'node:test';
import {
  bloqueoPorMetas,
  mensajeCapituloCerrado,
  posicionDeConversacion,
} from '../src/services/lectura-metas-core.service.js';

const metas = [
  { capitulo: 5, fecha: '2026-10-20' },
  { capitulo: 10, fecha: '2026-10-27' },
];
const cap = (n: number) => ({ tipo: 'capitulo' as const, n });

test('sin metas todo está abierto', () => {
  assert.deepEqual(bloqueoPorMetas([], '2026-10-12', 20, cap(15)), { bloqueado: false });
});

test('con la meta 1 en curso, del 6 en adelante está cerrado', () => {
  assert.deepEqual(bloqueoPorMetas(metas, '2026-10-12', 20, cap(5)), { bloqueado: false });
  assert.deepEqual(bloqueoPorMetas(metas, '2026-10-12', 20, cap(6)), {
    bloqueado: true,
    desbloqueaEl: '2026-10-21',
  });
  assert.deepEqual(bloqueoPorMetas(metas, '2026-10-12', 20, cap(11)), {
    bloqueado: true,
    desbloqueaEl: '2026-10-28',
  });
});

test('el propio día de la meta sigue cerrado lo siguiente; al día siguiente se abre', () => {
  assert.equal(bloqueoPorMetas(metas, '2026-10-20', 20, cap(6)).bloqueado, true);
  assert.equal(bloqueoPorMetas(metas, '2026-10-21', 20, cap(6)).bloqueado, false);
  assert.equal(bloqueoPorMetas(metas, '2026-10-21', 20, cap(10)).bloqueado, false);
  assert.equal(bloqueoPorMetas(metas, '2026-10-21', 20, cap(11)).bloqueado, true);
});

test('cumplidas todas las metas se abre el resto del libro', () => {
  assert.equal(bloqueoPorMetas(metas, '2026-10-28', 20, cap(20)).bloqueado, false);
  assert.equal(bloqueoPorMetas(metas, '2026-10-28', 20, { tipo: 'cierre' }).bloqueado, false);
});

test('prólogo siempre abierto; epílogo y reflexión final cerrados hasta el final', () => {
  assert.equal(bloqueoPorMetas(metas, '2026-10-12', 20, { tipo: 'prologo' }).bloqueado, false);
  assert.deepEqual(bloqueoPorMetas(metas, '2026-10-12', 20, { tipo: 'cierre' }), {
    bloqueado: true,
    desbloqueaEl: '2026-10-28',
  });
});

test('si la última meta llega al último capítulo, el cierre se abre con ella', () => {
  const todas = [{ capitulo: 20, fecha: '2026-11-03' }];
  assert.equal(bloqueoPorMetas(todas, '2026-10-12', 20, { tipo: 'cierre' }).bloqueado, false);
});

test('la posición se deduce del orden, con o sin prólogo', () => {
  assert.deepEqual(posicionDeConversacion(0, true, 3), { tipo: 'prologo' });
  assert.deepEqual(posicionDeConversacion(1, true, 3), { tipo: 'capitulo', n: 1 });
  assert.deepEqual(posicionDeConversacion(0, false, 3), { tipo: 'capitulo', n: 1 });
  assert.deepEqual(posicionDeConversacion(3, true, 3), { tipo: 'capitulo', n: 3 });
  assert.deepEqual(posicionDeConversacion(4, true, 3), { tipo: 'cierre' });
});

test('el mensaje dice cuándo se abre', () => {
  assert.match(mensajeCapituloCerrado('2026-10-21'), /21 de octubre/);
});
