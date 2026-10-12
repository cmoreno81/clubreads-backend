import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { prisma } from '../src/prisma.js';
import {
  fechaMadrid,
  normalizarMetas,
  sumarDias,
  textoRango,
} from '../src/services/lectura-metas-core.service.js';
import { enviarAvisosMetas } from '../src/services/lectura-metas.service.js';
import { actionBodySchemas } from '../src/validation/api-validation.js';

function falso(modelo: string, metodos: Record<string, (...a: never[]) => unknown>) {
  const original = Object.getOwnPropertyDescriptor(prisma, modelo);
  Object.defineProperty(prisma, modelo, { value: metodos, configurable: true });
  return () => {
    if (original) Object.defineProperty(prisma, modelo, original);
    else delete (prisma as Record<string, unknown>)[modelo];
  };
}

test('las metas son opcionales: sin lista no hay metas', () => {
  assert.deepEqual(normalizarMetas(undefined, 10), { ok: true, metas: [] });
  assert.deepEqual(normalizarMetas([], 10), { ok: true, metas: [] });
});

test('valida y ordena las metas por capítulo', () => {
  const r = normalizarMetas(
    [
      { capitulo: 10, fecha: '2026-11-01' },
      { capitulo: 5, fecha: '2026-10-18' },
    ],
    12,
  );
  assert.equal(r.ok, true);
  if (r.ok) assert.deepEqual(r.metas.map((m) => m.capitulo), [5, 10]);
});

test('rechaza capítulos fuera de rango, fechas falsas y metas repetidas', () => {
  assert.equal(normalizarMetas([{ capitulo: 13, fecha: '2026-10-18' }], 12).ok, false);
  assert.equal(normalizarMetas([{ capitulo: 0, fecha: '2026-10-18' }], 12).ok, false);
  assert.equal(normalizarMetas([{ capitulo: 3, fecha: '2026-02-31' }], 12).ok, false);
  assert.equal(normalizarMetas([{ capitulo: 3, fecha: '18/10/2026' }], 12).ok, false);
  assert.equal(
    normalizarMetas(
      [{ capitulo: 3, fecha: '2026-10-18' }, { capitulo: 3, fecha: '2026-10-19' }],
      12,
    ).ok,
    false,
  );
});

test('una meta posterior no puede caer antes que la anterior', () => {
  const r = normalizarMetas(
    [{ capitulo: 3, fecha: '2026-10-20' }, { capitulo: 6, fecha: '2026-10-18' }],
    12,
  );
  assert.equal(r.ok, false);
});

test('los textos de rango son claros', () => {
  assert.equal(textoRango(1, 5), 'los capítulos 1 a 5');
  assert.equal(textoRango(6, 6), 'el capítulo 6');
});

test('las fechas se calculan en hora de Madrid', () => {
  // 23:30 UTC del 10 ya es el día 11 en Madrid (verano o invierno).
  assert.equal(fechaMadrid(new Date('2026-10-10T23:30:00.000Z')), '2026-10-11');
  assert.equal(sumarDias('2026-10-31', 1), '2026-11-01');
});

test('los avisos de metas son positivos, van al día antes y el mismo día, y no se repiten', async () => {
  const hoy = '2026-10-17';
  const marcas: Array<Record<string, unknown>> = [];
  const avisos: Array<Record<string, unknown>> = [];
  const metaManana = {
    id: 'g2',
    upToChapter: 10,
    dueDate: new Date('2026-10-18T00:00:00.000Z'),
    reading: {
      id: 'r1', clubId: 'c1', bookId: 'b1', startedAt: new Date('2026-10-01'),
      book: { title: 'Entre dos tormentas' },
      goals: [{ upToChapter: 5 }, { upToChapter: 10 }],
    },
  };
  const metaHoy = {
    id: 'g1',
    upToChapter: 5,
    dueDate: new Date('2026-10-17T00:00:00.000Z'),
    reading: metaManana.reading,
  };
  const restaurar = [
    falso('readingGoal', {
      findMany: async () => [metaHoy, metaManana],
      update: async (args: { data: Record<string, unknown> }) => { marcas.push(args.data); },
    } as never),
    falso('library', { findMany: async () => [{ userId: 'u1' }, { userId: 'u2' }] }),
    falso('user', { findMany: async () => [{ id: 'u2' }] }), // u2 desactivó este aviso
    falso('notification', {
      createMany: async (a: { data: Array<Record<string, unknown>> }) => { avisos.push(...a.data); },
    }),
  ];
  try {
    const r = await enviarAvisosMetas(new Date(`${hoy}T08:00:00.000Z`));
    assert.equal(r.metas, 2);
    // Solo u1 (u2 lo tiene desactivado), en cada una de las dos metas.
    assert.equal(avisos.length, 2);
    const hoyMsg = avisos.find((a) => a.tipo === 'LECTURA_META_HOY')!;
    const proxima = avisos.find((a) => a.tipo === 'LECTURA_META_PROXIMA')!;
    assert.match(String(hoyMsg.titulo), /Hoy comentamos/);
    assert.match(String(hoyMsg.mensaje), /los capítulos 1 a 5/);
    assert.match(String(proxima.titulo), /Mañana comentamos/);
    assert.match(String(proxima.mensaje), /los capítulos 6 a 10/);
    // Nada de presión: ningún texto habla de retrasos.
    for (const a of avisos) assert.doesNotMatch(String(a.mensaje), /retras|atrasad|tarde|falta/i);
    // Se marcan para no repetirse.
    assert.equal(marcas.length, 2);
    assert.ok(marcas.some((m) => 'remindedTodayAt' in m));
    assert.ok(marcas.some((m) => 'remindedDayBeforeAt' in m));
  } finally {
    restaurar.reverse().forEach((r) => r());
  }
});

test('crearLectura y editarLectura aceptan metas opcionales y la configuración las devuelve', () => {
  const svc = readFileSync(new URL('../src/services/readings.service.ts', import.meta.url), 'utf8');
  assert.match(svc, /metas\?: unknown/);
  assert.match(svc, /guardarMetas\(tx, reading\.id, metasValidas\.metas\)/);
  assert.match(svc, /metas: await listarMetas\(reading\.id\)/);
  // Editar sin enviar «metas» no las toca.
  assert.match(svc, /Array\.isArray\(data\.metas\)/);
});

test('el esquema acepta metas y rechaza fechas mal formadas', () => {
  const crear = actionBodySchemas.crearLectura;
  const base = { libro: 'b1', capitulos: 10 };
  assert.equal(crear.safeParse(base).success, true);
  assert.equal(crear.safeParse({ ...base, metas: [{ capitulo: 5, fecha: '2026-10-18' }] }).success, true);
  assert.equal(crear.safeParse({ ...base, metas: [{ capitulo: 5, fecha: 'mañana' }] }).success, false);
  assert.equal(actionBodySchemas.invitarALectura.safeParse({ libro: 'b1', usuarios: ['u1'] }).success, true);
  assert.equal(actionBodySchemas.invitarALectura.safeParse({ libro: 'b1', usuarios: [] }).success, false);
});

test('la migración añade la tabla de metas y los tres tipos de aviso', () => {
  const sql = readFileSync(
    new URL('../prisma/migrations/20261012100000_reading_goals/migration.sql', import.meta.url),
    'utf8',
  );
  assert.match(sql, /CREATE TABLE "ReadingGoal"/);
  for (const t of ['LECTURA_META_PROXIMA', 'LECTURA_META_HOY', 'LECTURA_INVITACION']) {
    assert.match(sql, new RegExp(`ADD VALUE IF NOT EXISTS '${t}'`));
  }
  assert.match(sql, /ON DELETE CASCADE/);
});

test('invitarALectura es POST, solo invita a miembros del club y no a quien ya lee', () => {
  const svc = readFileSync(new URL('../src/services/lectura-metas.service.ts', import.meta.url), 'utf8');
  assert.match(svc, /clubMember\.findMany\(\{\s*where: \{ clubId: club\.id, userId: \{ in: ids, not: user\.id \} \}/);
  assert.match(svc, /!yaLeen\.has\(id\) && !yaInvitadas\.has\(id\)/);
  const router = readFileSync(new URL('../src/routes/api.router.ts', import.meta.url), 'utf8');
  assert.match(router, /case 'invitarALectura':\s*return handleInvitarALectura/);
  assert.match(router, /'invitarALectura',\s*\n\s*'guardarCategoriasComentario'/);
});
