import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { prisma } from '../src/prisma.js';
import {
  crearLecturaConAmistad,
  getLecturasAmistades,
  responderLecturaAmistad,
  salirLecturaAmistad,
} from '../src/services/lecturas-amistades.service.js';

type Op = {
  existente?: boolean;
  abiertas?: number;
  amigas?: string[];
  miembros?: number;
  lecturas?: number;
  mias?: any[];
  hechos?: Array<{ userId: string; bookId: string }>;
  membresia?: any;
};

/// Filas de «mis lecturas con amistades» como las devuelve la consulta de membresías.
function filasMias(op: Op) {
  if (op.mias) return op.mias;
  return Array.from({ length: op.abiertas ?? 0 }, (_, i) => fila({ clubId: `x${i}`, bookId: `bk${i}` }));
}

function fila(o: { clubId: string; bookId?: string; libro?: string; role?: string; yoFrom?: boolean; status?: string; miembros?: string[] }) {
  return {
    clubId: o.clubId,
    role: o.role ?? 'OWNER',
    club: {
      members: (o.miembros ?? ['yo', 'u0']).map((userId) => ({ userId })),
      friendReadingInvites: [
        {
          bookId: o.bookId ?? 'b1',
          bookTitle: o.libro ?? 'Yesteryear',
          status: o.status ?? 'ACCEPTED',
          fromUserId: o.yoFrom === false ? 'u0' : 'yo',
          toUserId: o.yoFrom === false ? 'yo' : 'u0',
          createdAt: new Date(2026, 9, 1),
          from: { name: o.yoFrom === false ? 'Lucía' : 'Cris', avatarUrl: null },
          to: { name: o.yoFrom === false ? 'Cris' : 'Lucía', avatarUrl: null },
        },
      ],
    },
  };
}

function falsear(op: Op = {}) {
  const log: Record<string, any[]> = { club: [], invite: [], miembro: [], notificacion: [], borrado: [], estado: [], salidas: [] };
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
      count: async ({ where }: any) => (where.clubId ? (op.miembros ?? 1) : 0),
      create: async ({ data }: any) => { log.miembro.push(data); return data; },
      findMany: async () => filasMias(op),
      findUnique: async () => op.membresia ?? null,
      update: async ({ data }: any) => { log.miembro.push(data); return {}; },
      delete: async ({ where }: any) => { log.salidas.push(where); return {}; },
    },
    club: {
      create: async ({ data }: any) => { log.club.push(data); return { id: 'cNuevo' }; },
      update: async ({ data }: any) => { log.club.push({ actualiza: data }); return {}; },
      delete: async ({ where }: any) => { log.borrado.push(where.id); return {}; },
    },
    reading: { count: async () => op.lecturas ?? 0 },
    readingCompletion: { findMany: async () => op.hechos ?? [] },
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

test('la lista junta invitaciones recibidas y lecturas con su estado: esperando, en curso y terminada', async () => {
  falsear({
    mias: [
      fila({ clubId: 'c2', libro: 'Esperando', bookId: 'b2', status: 'PENDING', miembros: ['yo'] }),
      fila({ clubId: 'c3', libro: 'En curso', bookId: 'b3' }),
      fila({ clubId: 'c4', libro: 'Terminada', bookId: 'b4', yoFrom: false, role: 'MEMBER' }),
      fila({ clubId: 'c5', libro: 'Otra salió', bookId: 'b5', miembros: ['yo'] }),
    ],
    hechos: [
      { userId: 'yo', bookId: 'b4' },
      { userId: 'u0', bookId: 'b4' },
      { userId: 'yo', bookId: 'b3' }, // solo yo: aún no es de las dos
    ],
  });
  const r: any = await getLecturasAmistades('yo');
  assert.deepEqual(r.recibidas.map((i: any) => [i.libro, i.de]), [['Yesteryear', 'Lucía']]);
  const por = Object.fromEntries(r.lecturas.map((l: any) => [l.libro, l]));
  assert.deepEqual([por['Esperando'].esperando, por['Esperando'].terminada], [true, false]);
  assert.deepEqual([por['En curso'].esperando, por['En curso'].terminada, por['En curso'].esDuena], [false, false, true]);
  assert.deepEqual([por['Terminada'].terminada, por['Terminada'].con, por['Terminada'].esDuena], [true, 'Lucía', false]);
  assert.deepEqual([por['Otra salió'].salio, por['Otra salió'].terminada], [true, false]);
});

test('el tope de 5 solo cuenta las lecturas que siguen en curso', async () => {
  // 5 abiertas y una terminada más: se puede crear porque solo hay 5 en curso... y con 5 en curso no.
  let log = falsear({
    mias: [
      ...Array.from({ length: 4 }, (_, i) => fila({ clubId: `c${i}`, bookId: `k${i}` })),
      fila({ clubId: 'cT', bookId: 'kT' }),
    ],
    hechos: [{ userId: 'yo', bookId: 'kT' }, { userId: 'u0', bookId: 'kT' }],
  });
  assert.equal(((await crearLecturaConAmistad('yo', { bookId: 'b1', nombre: 'Lucía' })) as any).ok, true);
  assert.equal(log.club.length, 1);
  log = falsear({ abiertas: 5 });
  assert.equal(((await crearLecturaConAmistad('yo', { bookId: 'b1', nombre: 'Lucía' })) as any).ok, false);
});

test('salir deja la lectura a la otra persona (y le pasa la propiedad); si no queda nadie, se borra', async () => {
  const yoDueña = { role: 'OWNER', club: { id: 'c1', tipo: 'AMISTADES', members: [{ userId: 'yo' }, { userId: 'u0' }], friendReadingInvites: [{ bookTitle: 'Yesteryear', status: 'ACCEPTED' }] }, user: { name: 'Cris' } };
  let log = falsear({ membresia: yoDueña });
  assert.equal(((await salirLecturaAmistad('yo', 'c1', false)) as any).ok, true);
  assert.deepEqual(log.salidas, [{ clubId_userId: { clubId: 'c1', userId: 'yo' } }]);
  assert.ok(log.miembro.some((m: any) => m.role === 'OWNER')); // la otra pasa a ser la propietaria
  assert.deepEqual(log.club, [{ actualiza: { ownerId: 'u0' } }]);
  assert.deepEqual(log.borrado, []);

  log = falsear({ membresia: { ...yoDueña, club: { ...yoDueña.club, members: [{ userId: 'yo' }] } } });
  assert.equal(((await salirLecturaAmistad('yo', 'c1', false)) as any).ok, true);
  assert.deepEqual(log.borrado, ['c1']);

  log = falsear({ membresia: null });
  assert.equal(((await salirLecturaAmistad('yo', 'c1', false)) as any).ok, false);
});

test('eliminar para las dos: solo quien la abrió, y la otra persona recibe un aviso', async () => {
  const base = { role: 'OWNER', club: { id: 'c1', tipo: 'AMISTADES', members: [{ userId: 'yo' }, { userId: 'u0' }], friendReadingInvites: [{ bookTitle: 'Yesteryear', status: 'ACCEPTED' }] }, user: { name: 'Cris' } };
  let log = falsear({ membresia: base });
  assert.equal(((await salirLecturaAmistad('yo', 'c1', true)) as any).ok, true);
  assert.deepEqual(log.borrado, ['c1']);
  assert.equal(log.notificacion[0].tipo, 'LECTURA_AMISTAD_ELIMINADA');
  assert.equal(log.notificacion[0].userId, 'u0');

  log = falsear({ membresia: { ...base, role: 'MEMBER' } });
  assert.equal(((await salirLecturaAmistad('yo', 'c1', true)) as any).ok, false);
  assert.deepEqual(log.borrado, []);
  assert.equal(log.notificacion.length, 0);
});

test('rutas, migración y cierre de invitaciones del club están conectados', () => {
  const router = readFileSync('src/routes/api.router.ts', 'utf8');
  for (const a of ['crearLecturaConAmistad', 'lecturasAmistades', 'responderLecturaAmistad', 'salirLecturaAmistad']) {
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

test('la configuración de la lectura dice si es entre amistades (para no ofrecer invitar al club)', () => {
  const src = readFileSync('src/services/readings.service.ts', 'utf8');
  assert.equal((src.match(/esAmistades: club\.tipo === ClubType\.AMISTADES/g) ?? []).length, 2);
});
