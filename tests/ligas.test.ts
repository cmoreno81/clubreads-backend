import assert from 'node:assert/strict';
import test from 'node:test';

import { ReadingStatus } from '@prisma/client';

import {
  RETO_SEMANAL_DIAS_OBJETIVO,
  RETO_SEMANAL_PUNTOS,
  SEASON_EPOCH,
  SEASON_LENGTH_DAYS,
  bonusPorRacha,
  calcularCambiosDivision,
  calcularCuotaAscensoDescenso,
  calcularTendencia,
  currentSeasonNumber,
  daysBetween,
  divisionInferior,
  divisionSuperior,
  eleccionBotyEnPlazo,
  HITOS_CONSTANCIA,
  medallasParaFila,
  primeraPorDia,
  puntosPorLibro,
  puntosPorPaginas,
  seasonEndsAt,
  seasonNumberForDate,
  seasonWindow,
  semanaDe,
  type FilaTabla,
  tzMidnightUtc,
} from '../src/services/ligas.service.js';
import { estabaEnLecturaActiva } from '../src/utils/reading-transition.utils.js';

// ── Temporadas ──────────────────────────────────────────────────────────────

test('la temporada 0 empieza en el epoch de lanzamiento', () => {
  assert.equal(seasonNumberForDate(SEASON_EPOCH), 0);
  assert.deepEqual(seasonWindow(0).startDate, SEASON_EPOCH);
});

test('cada temporada dura exactamente 14 días', () => {
  const w0 = seasonWindow(0);
  const w1 = seasonWindow(1);
  assert.equal(daysBetween(w0.startDate, w0.endDate), SEASON_LENGTH_DAYS);
  assert.equal(w0.endDate, w1.startDate);
  assert.equal(daysBetween(w0.startDate, w1.startDate), SEASON_LENGTH_DAYS);
});

test('los días caen en la temporada correcta', () => {
  const { startDate } = seasonWindow(3);
  assert.equal(seasonNumberForDate(startDate), 3);
  // Último día de la temporada 3
  const ultimo = seasonWindow(3).endDate;
  assert.equal(seasonNumberForDate(ultimo), 4); // endDate es exclusivo
});

test('las fechas anteriores al lanzamiento no tienen temporada', () => {
  const antes = seasonWindow(-1).startDate; // 14 días antes del epoch
  assert.equal(seasonNumberForDate(antes), -1);
});

test('currentSeasonNumber nunca es negativo', () => {
  assert.ok(currentSeasonNumber(new Date('2000-01-01T00:00:00Z')) >= 0);
});

test('seasonEndsAt coincide con la medianoche de Madrid del fin de ventana', () => {
  const fin = seasonEndsAt(0);
  assert.deepEqual(fin, tzMidnightUtc(seasonWindow(0).endDate));
  // Madrid en septiembre está en CEST (UTC+2): medianoche local = 22:00 UTC.
  assert.equal(fin.getUTCHours(), 22);
});

// ── Puntos ─────────────────────────────────────────────────────────────────

test('puntosPorPaginas: mismos tramos que el mapa de calor', () => {
  assert.equal(puntosPorPaginas(0), 0);
  assert.equal(puntosPorPaginas(1), 1);
  assert.equal(puntosPorPaginas(50), 1);
  assert.equal(puntosPorPaginas(51), 2);
  assert.equal(puntosPorPaginas(75), 2);
  assert.equal(puntosPorPaginas(76), 3);
  assert.equal(puntosPorPaginas(100), 3);
  assert.equal(puntosPorPaginas(101), 4);
  assert.equal(puntosPorPaginas(5_000), 4);
});

test('bonusPorRacha: longitud de la racha, tope 15', () => {
  assert.equal(bonusPorRacha(0), 0);
  assert.equal(bonusPorRacha(1), 1);
  assert.equal(bonusPorRacha(15), 15);
  assert.equal(bonusPorRacha(40), 15);
});

test('puntosPorLibro: 40 normal, 20 libro corto (<100 páginas), relecturas puntúan igual', () => {
  assert.equal(puntosPorLibro({ totalPages: 320 }), 40);
  assert.equal(puntosPorLibro({ totalPages: null }), 40);
  assert.equal(puntosPorLibro({ totalPages: 30 }), 20);
  assert.equal(puntosPorLibro({ totalPages: 99 }), 20);
  assert.equal(puntosPorLibro({ totalPages: 100 }), 40);
});

// ── Tendencia (sube/baja puestos) ───────────────────────────────────────────

test('calcularTendencia: sin dato anterior no hay tendencia', () => {
  assert.deepEqual(calcularTendencia(null, 5), { tendencia: null, delta: null });
});

test('calcularTendencia: bajar de puesto numérico es subir en la clasificación', () => {
  assert.deepEqual(calcularTendencia(8, 5), { tendencia: 'sube', delta: 3 });
});

test('calcularTendencia: subir de puesto numérico es bajar en la clasificación', () => {
  assert.deepEqual(calcularTendencia(2, 6), { tendencia: 'baja', delta: -4 });
});

test('calcularTendencia: mismo puesto es igual', () => {
  assert.deepEqual(calcularTendencia(4, 4), { tendencia: 'igual', delta: 0 });
});

// ── Divisiones ──────────────────────────────────────────────────────────────

test('divisionSuperior/divisionInferior no se salen del rango', () => {
  assert.equal(divisionSuperior('BRONCE'), 'PLATA');
  assert.equal(divisionSuperior('DIAMANTE'), 'DIAMANTE'); // techo
  assert.equal(divisionInferior('PLATA'), 'BRONCE');
  assert.equal(divisionInferior('BRONCE'), 'BRONCE'); // suelo
});

test('calcularCuotaAscensoDescenso: con menos de 3 nadie se mueve', () => {
  assert.deepEqual(calcularCuotaAscensoDescenso(1), { suben: 0, bajan: 0 });
  assert.deepEqual(calcularCuotaAscensoDescenso(2), { suben: 0, bajan: 0 });
});

test('calcularCuotaAscensoDescenso: deja siempre a alguien en medio', () => {
  assert.deepEqual(calcularCuotaAscensoDescenso(3), { suben: 1, bajan: 1 });
  assert.deepEqual(calcularCuotaAscensoDescenso(5), { suben: 1, bajan: 1 });
});

test('calcularCuotaAscensoDescenso: ~20% arriba y abajo en divisiones grandes', () => {
  assert.deepEqual(calcularCuotaAscensoDescenso(25), { suben: 5, bajan: 5 });
  assert.deepEqual(calcularCuotaAscensoDescenso(10), { suben: 2, bajan: 2 });
});

function filaDePrueba(userId: string, puesto: number): FilaTabla {
  return { userId, puesto, nombre: userId, avatarUrl: null, puntos: 100 - puesto, esTu: false };
}

test('calcularCambiosDivision: sube el top, baja la cola, nadie en medio se mueve', () => {
  const tabla = [1, 2, 3, 4, 5].map((n) => filaDePrueba(`u${n}`, n));
  const cambios = calcularCambiosDivision(tabla, 'PLATA');
  assert.equal(cambios.get('u1'), 'ORO');
  assert.equal(cambios.get('u5'), 'BRONCE');
  assert.equal(cambios.has('u2'), false);
  assert.equal(cambios.has('u3'), false);
  assert.equal(cambios.has('u4'), false);
});

test('calcularCambiosDivision: en Diamante no hay ascenso; en Bronce no hay descenso', () => {
  const tabla = [1, 2, 3, 4, 5].map((n) => filaDePrueba(`u${n}`, n));
  const enDiamante = calcularCambiosDivision(tabla, 'DIAMANTE');
  assert.equal(enDiamante.has('u1'), false); // no hay división por encima
  assert.equal(enDiamante.get('u5'), 'PLATINO');

  const enBronce = calcularCambiosDivision(tabla, 'BRONCE');
  assert.equal(enBronce.get('u1'), 'PLATA');
  assert.equal(enBronce.has('u5'), false); // no hay división por debajo
});

// ── Medallas de temporada ────────────────────────────────────────────────────

test('medallasParaFila: podio de oro, plata y bronce según puesto', () => {
  assert.deepEqual(
    medallasParaFila(filaDePrueba('u1', 1), 'PLATA', new Map(), 0, false),
    [{ tier: 'PODIO_ORO', rank: 1 }],
  );
  assert.deepEqual(
    medallasParaFila(filaDePrueba('u2', 2), 'PLATA', new Map(), 0, false),
    [{ tier: 'PODIO_PLATA', rank: 2 }],
  );
  assert.deepEqual(
    medallasParaFila(filaDePrueba('u3', 3), 'PLATA', new Map(), 0, false),
    [{ tier: 'PODIO_BRONCE', rank: 3 }],
  );
  assert.deepEqual(medallasParaFila(filaDePrueba('u4', 4), 'PLATA', new Map(), 0, false), []);
});

test('medallasParaFila: medalla de ascenso solo para quien sube de verdad', () => {
  const cambios = new Map([['u1', 'ORO' as const]]);
  const conAscenso = medallasParaFila(filaDePrueba('u1', 1), 'PLATA', cambios, 0, false);
  assert.ok(conAscenso.some((m) => m.tier === 'ASCENSO'));

  const sinAscenso = medallasParaFila(filaDePrueba('u2', 2), 'PLATA', cambios, 0, false);
  assert.ok(!sinAscenso.some((m) => m.tier === 'ASCENSO'));
});

test('medallasParaFila: Diamante se otorga solo una vez por usuaria', () => {
  const primeraVez = medallasParaFila(filaDePrueba('u1', 5), 'DIAMANTE', new Map(), 0, false);
  assert.ok(primeraVez.some((m) => m.tier === 'DIAMANTE'));

  const yaLaTenia = medallasParaFila(filaDePrueba('u1', 5), 'DIAMANTE', new Map(), 0, true);
  assert.ok(!yaLaTenia.some((m) => m.tier === 'DIAMANTE'));

  // Fuera de Diamante nunca se otorga, aunque sea la primera vez.
  const otraDivision = medallasParaFila(filaDePrueba('u1', 5), 'ORO', new Map(), 0, false);
  assert.ok(!otraDivision.some((m) => m.tier === 'DIAMANTE'));
});

test('medallasParaFila: constancia solo en los hitos exactos de racha', () => {
  for (const racha of HITOS_CONSTANCIA) {
    const medallas = medallasParaFila(filaDePrueba('u1', 8), 'ORO', new Map(), racha, false);
    assert.deepEqual(
      medallas.find((m) => m.tier === 'CONSTANCIA'),
      { tier: 'CONSTANCIA', streak: racha },
    );
  }
  assert.ok(
    !medallasParaFila(filaDePrueba('u1', 8), 'ORO', new Map(), 4, false).some(
      (m) => m.tier === 'CONSTANCIA',
    ),
  );
});

test('medallasParaFila: una misma fila puede ganar varias medallas a la vez', () => {
  const cambios = new Map([['u1', 'DIAMANTE' as const]]);
  const medallas = medallasParaFila(filaDePrueba('u1', 1), 'PLATINO', cambios, 5, false);
  const tiers = medallas.map((m) => m.tier).sort();
  assert.deepEqual(tiers, ['ASCENSO', 'CONSTANCIA', 'PODIO_ORO']);
});

// ── Semana del reto (lunes a domingo) ───────────────────────────────────────

test('semanaDe: cualquier día de la semana da el mismo lunes de inicio', () => {
  // 2026-09-14 es lunes; 2026-09-20 es domingo de esa misma semana.
  assert.deepEqual(semanaDe('2026-09-14'), { inicio: '2026-09-14', fin: '2026-09-21' });
  assert.deepEqual(semanaDe('2026-09-17'), { inicio: '2026-09-14', fin: '2026-09-21' });
  assert.deepEqual(semanaDe('2026-09-20'), { inicio: '2026-09-14', fin: '2026-09-21' });
  // El lunes siguiente ya es otra semana.
  assert.deepEqual(semanaDe('2026-09-21'), { inicio: '2026-09-21', fin: '2026-09-28' });
});

test('el reto semanal tiene un objetivo y una recompensa fijados', () => {
  assert.equal(RETO_SEMANAL_DIAS_OBJETIVO, 5);
  assert.equal(RETO_SEMANAL_PUNTOS, 30);
});

// ── Juego limpio: puntos que no dependen de cuándo entras en la app ─────────

test('eleccionBotyEnPlazo: puntúa si se elige durante el mes o el siguiente', () => {
  assert.equal(eleccionBotyEnPlazo(2026, 9, new Date('2026-09-15T10:00:00Z')), true);
  assert.equal(eleccionBotyEnPlazo(2026, 8, new Date('2026-09-20T10:00:00Z')), true);
});

test('eleccionBotyEnPlazo: rellenar meses atrasados no puntúa', () => {
  assert.equal(eleccionBotyEnPlazo(2026, 1, new Date('2026-09-20T10:00:00Z')), false);
  assert.equal(eleccionBotyEnPlazo(2026, 7, new Date('2026-09-01T10:00:00Z')), false);
});

test('eleccionBotyEnPlazo: el plazo de noviembre y diciembre cruza de año', () => {
  assert.equal(eleccionBotyEnPlazo(2026, 11, new Date('2026-12-31T12:00:00Z')), true);
  assert.equal(eleccionBotyEnPlazo(2026, 11, new Date('2027-01-02T12:00:00Z')), false);
  assert.equal(eleccionBotyEnPlazo(2026, 12, new Date('2027-01-31T12:00:00Z')), true);
  assert.equal(eleccionBotyEnPlazo(2026, 12, new Date('2027-02-01T12:00:00Z')), false);
});

test('estabaEnLecturaActiva: solo cuenta lo que pasó por "Leyendo ahora"', () => {
  assert.equal(estabaEnLecturaActiva(ReadingStatus.READING), true);
  assert.equal(estabaEnLecturaActiva(ReadingStatus.REREADING), true);
  assert.equal(estabaEnLecturaActiva(ReadingStatus.PAUSED), true);
  assert.equal(estabaEnLecturaActiva(ReadingStatus.PENDING), false);
  assert.equal(estabaEnLecturaActiva(null), false);
  assert.equal(estabaEnLecturaActiva(undefined), false);
});

test('primeraPorDia: de los libros marcados directamente, uno por día', () => {
  const ids = primeraPorDia([
    { id: 'a', createdAt: new Date('2026-09-16T12:44:38Z') },
    { id: 'b', createdAt: new Date('2026-09-16T14:30:52Z') },
    { id: 'c', createdAt: new Date('2026-09-17T14:33:58Z') },
  ]);
  assert.deepEqual([...ids].sort(), ['a', 'c']);
});

test('primeraPorDia: volcar el historial de golpe solo suma un libro', () => {
  const volcado = Array.from({ length: 30 }, (_, i) => ({
    id: `libro-${String(i).padStart(2, '0')}`,
    createdAt: new Date(Date.UTC(2026, 8, 20, 18, 0, i)),
  }));
  assert.deepEqual([...primeraPorDia(volcado)], ['libro-00']);
});

test('primeraPorDia: el día se cuenta en hora de Madrid', () => {
  // 23:30 UTC del 16 ya es día 17 en Madrid.
  const ids = primeraPorDia([
    { id: 'a', createdAt: new Date('2026-09-16T20:00:00Z') },
    { id: 'b', createdAt: new Date('2026-09-16T23:30:00Z') },
  ]);
  assert.deepEqual([...ids].sort(), ['a', 'b']);
});
