import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { periodoDelReto, rachaConjunta } from '../src/services/amistades-retos.service.js';

const dias = (...d: string[]) => new Set(d);

test('racha compartida: cuenta los días seguidos en que las dos hacéis check-in', () => {
  const r = rachaConjunta(dias('2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15'), dias('2026-10-13', '2026-10-14', '2026-10-15'), '2026-10-15');
  assert.deepEqual(r, { dias: 3, hoyLasDos: true, yoHoy: true, ellaHoy: true });
});

test('racha compartida: si hoy aún falta una, sigue viva contando desde ayer', () => {
  const r = rachaConjunta(dias('2026-10-13', '2026-10-14'), dias('2026-10-13', '2026-10-14', '2026-10-15'), '2026-10-15');
  assert.equal(r.dias, 2);
  assert.equal(r.hoyLasDos, false);
  assert.equal(r.yoHoy, false);
  assert.equal(r.ellaHoy, true);
});

test('racha compartida: un día sin una de las dos la corta', () => {
  assert.equal(rachaConjunta(dias('2026-10-12', '2026-10-14'), dias('2026-10-12', '2026-10-13', '2026-10-14'), '2026-10-14').dias, 1);
  assert.equal(rachaConjunta(dias('2026-10-10'), dias('2026-10-10'), '2026-10-15').dias, 0);
});

test('el reto dura el mes o el año en curso', () => {
  const ahora = new Date('2026-10-15T12:00:00Z');
  assert.equal(periodoDelReto('MES', ahora).desde.toISOString(), '2026-10-01T00:00:00.000Z');
  assert.equal(periodoDelReto('MES', ahora).hasta.toISOString(), '2026-11-01T00:00:00.000Z');
  assert.equal(periodoDelReto('ANO', ahora).hasta.toISOString(), '2027-01-01T00:00:00.000Z');
});

test('las acciones de retos y racha están enganchadas al router (las que escriben, solo POST)', () => {
  const router = readFileSync('src/routes/api.router.ts', 'utf8');
  for (const a of ['retosAmigos', 'crearRetoAmigos', 'responderRetoAmigos', 'salirRetoAmigos', 'rachasCompartidas']) {
    assert.match(router, new RegExp(`case '${a}':`));
  }
  for (const a of ['crearRetoAmigos', 'responderRetoAmigos', 'salirRetoAmigos']) {
    assert.match(router, new RegExp(`'${a}',`));
  }
});

test('libros para recomendar: leídos por nota y luego pendientes; ruta enganchada', async () => {
  const { ordenarOpcionesRecomendar } = await import('../src/services/amistades-recomendar.service.js');
  const o = (bookId: string, titulo: string, nota: number, leido: boolean) => ({ bookId, titulo, coverUrl: '', nota, leido });
  const r = ordenarOpcionesRecomendar([o('p', 'Zeta', 0, false), o('a', 'Babel', 4, true), o('b', 'Dune', 5, true), o('c', 'Ana', 0, false)]);
  assert.deepEqual(r.map((x) => x.bookId), ['b', 'a', 'c', 'p']);
  assert.match(readFileSync('src/routes/api.router.ts', 'utf8'), /case 'librosParaRecomendar':/);
});
