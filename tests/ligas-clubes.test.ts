import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MIN_MIEMBROS_RANKING_EFICIENCIA,
  ordenarPorMedia,
  ordenarPorTotal,
  type ClubAgregado,
} from '../src/services/ligas-clubes.service.js';

function club(
  clubId: string,
  nombre: string,
  totalPoints: number,
  activeMembers: number,
): ClubAgregado {
  return { clubId, nombre, avatarUrl: null, totalPoints, activeMembers };
}

// ── "Más activos" (suma total) ──────────────────────────────────────────────

test('el ranking de "más activos" ordena por puntos totales, sin importar el tamaño', () => {
  const agregados = [
    club('a', 'Club Grande', 500, 30),
    club('b', 'Club Pequeño', 200, 4),
  ];
  const tabla = ordenarPorTotal(agregados);
  assert.equal(tabla[0]!.clubId, 'a'); // gana el grande: tiene más puntos en bruto
  assert.equal(tabla[1]!.clubId, 'b');
  assert.equal(tabla[0]!.puesto, 1);
  assert.equal(tabla[1]!.puesto, 2);
});

test('"más activos" desempata alfabéticamente por nombre', () => {
  const agregados = [club('a', 'Zeta', 100, 5), club('b', 'Alfa', 100, 5)];
  const tabla = ordenarPorTotal(agregados);
  assert.equal(tabla[0]!.clubId, 'b'); // "Alfa" antes que "Zeta"
});

test('"más activos" incluye clubes por debajo del mínimo de eficiencia', () => {
  const agregados = [club('a', 'Dúo', 999, 2)];
  const tabla = ordenarPorTotal(agregados);
  assert.equal(tabla.length, 1);
});

// ── "Más eficientes" (media por miembro) — el ranking justo ────────────────

test('un club pequeño y constante puede ganar en eficiencia a uno grande y disperso', () => {
  const agregados = [
    club('grande', 'Club Grande', 500, 30), // media 16.7
    club('pequeno', 'Club Constante', 200, 4), // media 50
  ];
  const tabla = ordenarPorMedia(agregados);
  assert.equal(tabla[0]!.clubId, 'pequeno');
  assert.equal(tabla[0]!.avgPoints, 50);
  assert.equal(tabla[1]!.clubId, 'grande');
  assert.ok(Math.abs(tabla[1]!.avgPoints - 500 / 30) < 1e-9);
});

test(`"más eficientes" exige al menos ${MIN_MIEMBROS_RANKING_EFICIENCIA} miembros participantes`, () => {
  const agregados = [
    club('solo', 'Club de Una', 1000, 1), // media altísima, pero no cuenta
    club('trio', 'Club de Tres', 300, 3),
  ];
  const tabla = ordenarPorMedia(agregados);
  assert.equal(tabla.length, 1);
  assert.equal(tabla[0]!.clubId, 'trio');
});

test('"más eficientes" desempata alfabéticamente ante misma media', () => {
  const agregados = [
    club('a', 'Zeta', 300, 3),
    club('b', 'Alfa', 300, 3),
  ];
  const tabla = ordenarPorMedia(agregados);
  assert.equal(tabla[0]!.clubId, 'b');
});

test('con cero clubes elegibles, "más eficientes" devuelve tabla vacía', () => {
  const agregados = [club('solo', 'Club de Una', 1000, 1)];
  assert.deepEqual(ordenarPorMedia(agregados), []);
});
