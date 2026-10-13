import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { prisma } from '../src/prisma.js';
import {
  crearLecturaConAmistad,
  getLecturasAmistades,
  responderLecturaAmistad,
} from '../src/services/lecturas-amistades.service.js';

type Op = { existente?: boolean; abiertas?: number; amigas?: string[]; miembros?: number; lecturas?: number };

function falsear(op: Op = {}) {
  const log: Record<string, any[]> = { club: [], invite: [], miembro: [], notificacion: [], borrado: [], estado: [] };
  const def = (m: string, v: unknown) => Object.defineProperty(prisma, m, { configurable: true, value: v });
  const amigas = op.amigas ?? ['Lucía'];
  const base: any = {
    user: {
      findUnique: async () => ({ id: 'yo', name: 'Cris' }),
      findMany: async () => [],
      updateMany: async () => ({}),
    },
    book: { findFirst: async ({ where }: any) => (where.id === 'b1' ? { id: 'b1', title: 'Yesteryear' } : null) },
    friendship: {
      findMany: async () =>
        amigas.map((n, i) => ({
          requesterId: 'yo',
          addresseeId: `u${i}`,
          requester: { id: 'yo', name: 'Cris' },
          addressee: { id: `u${i}`, name: n },
        })),
    },
    friendReadingInvite: {
      findFirst: async (args: any) =>
        args.where.toUserId === 'yo' || args.where.clubId
          ? { id: 'i1', clubId: 'c1', fromUserId: 'u0', bookId: 'b1', bookTitle: 'Yesteryear', from: { id: 'u0' }, to: { name: 'Cris' } }
          : op.existente
            ? { clubId: 'cx' }
            : null,
      create: async ({ data }: any) => { log.invite.push(data); return data; },
      update: async ({ data }: any) => { log.estado.push(data.status); return {}; },
      findMany: async () => [
        { clubId: 'c1', bookId: 'b1', bookTitle: 'Yesteryear', from: { name: 'Lucía', avatarUrl: null } },
      ],
    },
    clubMember: {
      count: async ({ where }: any) => (where.clubId ? (op.miembros ?? 1) : (op.abiertas ?? 0)),
      create: async ({ data }: any) => { log.miembro.push(data); return data; },
      findMany: async () => [
        {
          clubId: 'c2',
          club: {
            friendReadingInvites: [
              { bookId: 'b9', bookTitle: 'Otro', status: 'PENDING', fromUserId: 'yo', from: { name: 'Cris', avatarUrl: null }, to: { name: 'Marta', avatarUrl: null } },
            ],
          },
        },
      ],
    },
    club: {
      create: async ({ data }: any) => { log.club.push(data); return { id: 'cNuevo' }; },
      delete: async ({ where }: any) => { log.borrado.push(where.id); return {}; },
    },
    reading: { count: async () => op.lecturas ?? 0 },
    notification: { create: async ({ data }: any) => { log.notificacion.push(data); return data; } },
  };
  for (const [k, v] of Object.entries(base)) def(k, v);
  def('$transaction', async (fn: any) => fn(base));
  return log;
}

test('crear una lectura con una amistad monta un club de pareja, la invitación y el aviso', async () => {
  const log = falsear();
  const r: any = await crearLecturaConAmistad('yo', { bookId: 'b1', nombre: 'lucía' });
  assert.equal(r.ok, true);
  assert.equal(r.clubId, 'cNuevo');
  assert.equal(log.club[0].tipo, 'AMISTADES');
  assert.equal(log.club[0].visibility, 'PRIVATE');
  assert.ok(!('inviteCode' in log.club[0]));
  assert.equal(log.invite[0].toUserId, 'u0');
  assert.equal(log.notificacion[0].tipo, 'LECTURA_AMISTAD_INVITACION');
  assert.match(log.notificacion[0].mensaje, /Cris te propone leer «Yesteryear» a la vez/);
});

test('no se crea con quien no es amistad, ni con libro inexistente, ni pasado de tope; si ya existe, se vuelve a ella', async () => {
  let log = falsear({ amigas: ['Otra'] });
  assert.equal(((await crearLecturaConAmistad('yo', { bookId: 'b1', nombre: 'Lucía' })) as any).ok, false);
  log = falsear();
  assert.equal(((await crearLecturaConAmistad('yo', { bookId: 'nope', nombre: 'Lucía' })) as any).ok, false);
  log = falsear({ abiertas: 5 });
  assert.equal(((await crearLecturaConAmistad('yo', { bookId: 'b1', nombre: 'Lucía' })) as any).ok, false);
  assert.equal(log.club.length, 0);
  log = falsear({ existente: true });
  const r: any = await crearLecturaConAmistad('yo', { bookId: 'b1', nombre: 'Lucía' });
  assert.deepEqual([r.ok, r.clubId, r.yaExistia], [true, 'cx', true]);
  assert.equal(log.club.length, 0);
});

test('aceptar mete a la pareja en el club y avisa; rechazar sin lectura retira el club', async () => {
  let log = falsear();
  const ok: any = await responderLecturaAmistad('yo', 'c1', true);
  assert.equal(ok.ok, true);
  assert.equal(log.miembro[0].role, 'MEMBER');
  assert.equal(log.estado[0], 'ACCEPTED');
  assert.equal(log.notificacion[0].tipo, 'LECTURA_AMISTAD_ACEPTADA');

  log = falsear({ miembros: 2 });
  assert.equal(((await responderLecturaAmistad('yo', 'c1', true)) as any).ok, false);
  assert.equal(log.miembro.length, 0);

  log = falsear();
  const no: any = await responderLecturaAmistad('yo', 'c1', false);
  assert.equal(no.ok, true);
  assert.equal(log.estado[0], 'DECLINED');
  assert.deepEqual(log.borrado, ['c1']);
  assert.equal(log.notificacion.length, 0);

  log = falsear({ lecturas: 1 });
  await responderLecturaAmistad('yo', 'c1', false);
  assert.deepEqual(log.borrado, []);
});

test('la lista junta invitaciones recibidas y lecturas con quién y si esperan respuesta', async () => {
  falsear();
  const r: any = await getLecturasAmistades('yo');
  assert.deepEqual(r.recibidas.map((i: any) => [i.libro, i.de]), [['Yesteryear', 'Lucía']]);
  assert.deepEqual(r.lecturas.map((l: any) => [l.libro, l.con, l.esperando]), [['Otro', 'Marta', true]]);
});

test('rutas, migración y cierre de invitaciones del club están conectados', () => {
  const router = readFileSync('src/routes/api.router.ts', 'utf8');
  for (const a of ['crearLecturaConAmistad', 'lecturasAmistades', 'responderLecturaAmistad']) {
    assert.match(router, new RegExp(`case '${a}'`));
  }
  assert.match(router, /'crearLecturaConAmistad',\s*'responderLecturaAmistad'/);
  assert.match(readFileSync('src/services/clubs.service.ts', 'utf8'), /FRIEND_READING_IS_CLOSED/);
  assert.match(
    readFileSync('prisma/migrations/20261016160000_friend_readings/migration.sql', 'utf8'),
    /ADD VALUE IF NOT EXISTS 'AMISTADES'/,
  );
});

test('las lecturas con amistades no salen en «Tus clubes» ni en la lista de clubes', () => {
  for (const f of ['src/services/general-dashboard.service.ts', 'src/services/clubs.service.ts']) {
    assert.match(readFileSync(f, 'utf8'), /tipo: \{ not: ClubType\.AMISTADES \}/);
  }
});
