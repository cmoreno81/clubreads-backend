import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';

import { prisma } from '../src/prisma.js';
import {
  ALFABETO_CODIGO,
  crearLimitador,
  estadoDeAmistad,
  formatearCodigoAmistad,
  generarCodigoAmistad,
  normalizarCodigoAmistad,
} from '../src/services/amistades-core.js';
import {
  buscarPersonas,
  getAmistades,
  quitarAmistad,
  responderAmistad,
  solicitarAmistad,
} from '../src/services/amistades.service.js';

test('el código tiene 8 caracteres legibles y se normaliza lo que escribe la gente', () => {
  const codigo = generarCodigoAmistad();
  assert.equal(codigo.length, 8);
  assert.ok([...codigo].every((c) => ALFABETO_CODIGO.includes(c)));
  assert.equal(formatearCodigoAmistad('ABCD2345'), 'ABCD-2345');
  assert.equal(normalizarCodigoAmistad(' abcd-2345 '), 'ABCD2345');
  assert.equal(normalizarCodigoAmistad('ABCD-234'), null); // corto
  assert.equal(normalizarCodigoAmistad('ABCD-OI01'), null); // letras que no existen
});

test('estado de la relación y límite de uso', () => {
  assert.equal(estadoDeAmistad('yo', undefined), 'NINGUNA');
  assert.equal(estadoDeAmistad('yo', { requesterId: 'yo', status: 'PENDING' }), 'ENVIADA');
  assert.equal(estadoDeAmistad('yo', { requesterId: 'otra', status: 'PENDING' }), 'RECIBIDA');
  assert.equal(estadoDeAmistad('yo', { requesterId: 'otra', status: 'ACCEPTED' }), 'AMIGA');
  const limite = crearLimitador(2, 1000);
  assert.equal(limite('a', 0), true);
  assert.equal(limite('a', 10), true);
  assert.equal(limite('a', 20), false);
  assert.equal(limite('b', 20), true);
  assert.equal(limite('a', 1500), true); // pasó la ventana
});

type Fila = { id: string; requesterId: string; addresseeId: string; status: 'PENDING' | 'ACCEPTED'; createdAt: Date; respondedAt: Date | null };

function montar(opciones: {
  usuarios: Array<{ id: string; name: string; friendCode?: string | null; profileVisibility?: string; avatarUrl?: string | null }>;
  amistades?: Fila[];
  bloqueos?: Array<{ blockerId: string; blockedId: string }>;
  /// Membresías de clubes SOCIAL (para «club en común»).
  clubes?: Array<{ clubId: string; clubName: string; userId: string }>;
}) {
  const filas = opciones.amistades ?? [];
  const consultas: unknown[] = [];
  const sobre = (modelo: string, valor: unknown) =>
    Object.defineProperty(prisma, modelo, { configurable: true, value: valor });
  const poseedora = (f: Fila, userId: string) => f.requesterId === userId || f.addresseeId === userId;
  const igual = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
  const clubes = opciones.clubes ?? [];
  sobre('clubMember', {
    findMany: async ({ where }: any) =>
      where.clubId
        ? clubes
            .filter((c) => where.clubId.in.includes(c.clubId) && c.userId !== where.userId.not)
            .map((c) => ({ userId: c.userId, club: { name: c.clubName } }))
        : clubes.filter((c) => c.userId === where.userId).map((c) => ({ clubId: c.clubId })),
  });
  sobre('user', {
    findUnique: async ({ where }: any) =>
      opciones.usuarios.find((u) => (where.id ? u.id === where.id : u.friendCode === where.friendCode)) ?? null,
    findFirst: async ({ where }: any) =>
      opciones.usuarios.find(
        (u) => igual(u.name, where.name.equals) && (u.profileVisibility ?? 'PUBLICO') === where.profileVisibility,
      ) ?? null,
    findMany: async (args: any) => {
      consultas.push(args);
      if (!args.where.name) return []; // lo usan los avisos
      return opciones.usuarios.filter(
        (u) =>
          u.id !== args.where.id.not &&
          !(args.where.id.notIn ?? []).includes(u.id) &&
          u.name.toLowerCase().includes(args.where.name.contains.toLowerCase()) &&
          (u.profileVisibility ?? 'PUBLICO') === args.where.profileVisibility,
      );
    },
    update: async ({ where, data }: any) => {
      const u = opciones.usuarios.find((x) => x.id === where.id)!;
      u.friendCode = data.friendCode;
      return { friendCode: u.friendCode };
    },
  });
  sobre('userBlock', {
    findMany: async () => opciones.bloqueos ?? [],
  });
  sobre('friendship', {
    findMany: async ({ where }: any) => {
      const yo = where.OR[0].requesterId ?? where.OR[0].addresseeId;
      return filas
        .filter((f) => poseedora(f, yo))
        .map((f) => ({
          ...f,
          requester: opciones.usuarios.find((u) => u.id === f.requesterId),
          addressee: opciones.usuarios.find((u) => u.id === f.addresseeId),
        }));
    },
    findFirst: async ({ where }: any) => {
      if (where.requester) {
        const f = filas.find(
          (x) =>
            x.addresseeId === where.addresseeId &&
            x.status === where.status &&
            igual(opciones.usuarios.find((u) => u.id === x.requesterId)!.name, where.requester.name.equals),
        );
        return f
          ? {
              ...f,
              requester: opciones.usuarios.find((u) => u.id === f.requesterId),
              addressee: opciones.usuarios.find((u) => u.id === f.addresseeId),
            }
          : null;
      }
      const [a, b] = where.OR;
      return (
        filas.find(
          (f) =>
            (f.requesterId === a.requesterId && f.addresseeId === a.addresseeId) ||
            (f.requesterId === b.requesterId && f.addresseeId === b.addresseeId),
        ) ?? null
      );
    },
    count: async ({ where }: any) =>
      filas.filter((f) => f.requesterId === where.requesterId && (where.status ? f.status === where.status : true)).length,
    create: async ({ data }: any) => {
      filas.push({ id: `f${filas.length + 1}`, ...data, status: 'PENDING', createdAt: new Date(), respondedAt: null });
    },
    update: async ({ where, data }: any) => {
      Object.assign(filas.find((f) => f.id === where.id)!, data);
    },
    delete: async ({ where }: any) => {
      filas.splice(filas.findIndex((f) => f.id === where.id), 1);
    },
    deleteMany: async ({ where }: any) => {
      let borradas = 0;
      for (let i = filas.length - 1; i >= 0; i--) {
        const f = filas[i]!;
        const nombrePedido = (where.addressee?.name ?? where.OR?.[0]?.addressee?.name)?.equals;
        const coincide = where.OR
          ? (f.requesterId === where.OR[0].requesterId &&
              igual(opciones.usuarios.find((u) => u.id === f.addresseeId)!.name, where.OR[0].addressee.name.equals)) ||
            (f.addresseeId === where.OR[1].addresseeId &&
              igual(opciones.usuarios.find((u) => u.id === f.requesterId)!.name, where.OR[1].requester.name.equals))
          : f.requesterId === where.requesterId && igual(opciones.usuarios.find((u) => u.id === f.addresseeId)!.name, nombrePedido);
        if (coincide && f.status === where.status) {
          filas.splice(i, 1);
          borradas++;
        }
      }
      return { count: borradas };
    },
  });
  // Los avisos no se prueban aquí.
  return { filas, consultas };
}

const yo = { id: 'u1', name: 'Cris', friendCode: 'ABCD2345' };
const lucia = { id: 'u2', name: 'Lucía', friendCode: 'LUCA2345', profileVisibility: 'PUBLICO' };
const privada = { id: 'u3', name: 'Reservada', friendCode: 'PRVA2345', profileVisibility: 'CLUB' };

test('buscar solo encuentra perfiles públicos, pide 3 letras y marca el estado', async () => {
  const { filas } = montar({
    usuarios: [yo, lucia, privada, { id: 'u4', name: 'Lucía Reservada', profileVisibility: 'CLUB' }],
    amistades: [],
  });
  assert.equal((await buscarPersonas('u1', 'lu')).ok, false);
  const r = (await buscarPersonas('u1', 'luc')) as any;
  assert.deepEqual(r.personas.map((p: any) => [p.nombre, p.estado]), [['Lucía', 'NINGUNA']]);
  assert.equal(filas.length, 0);
  const sinPrivadas = (await buscarPersonas('u1', 'reserv')) as any;
  assert.equal(sinPrivadas.personas.length, 0);
});

test('solicitar por nombre o por código, sin duplicar, y no a uno mismo ni a una cuenta privada', async () => {
  const { filas } = montar({ usuarios: [yo, lucia, privada] });
  assert.equal(((await solicitarAmistad('u1', { nombre: 'lucía' })) as any).estado, 'ENVIADA');
  assert.equal(filas.length, 1);
  assert.equal(((await solicitarAmistad('u1', { codigo: 'luca-2345' })) as any).estado, 'ENVIADA'); // ya enviada
  assert.equal(filas.length, 1);
  assert.equal((await solicitarAmistad('u1', { nombre: 'Reservada' })).ok, false); // no se puede por nombre
  const porCodigo = (await solicitarAmistad('u1', { codigo: 'PRVA2345' })) as any;
  assert.equal(porCodigo.estado, 'ENVIADA', JSON.stringify(porCodigo)); // por código sí
  assert.equal((await solicitarAmistad('u1', { codigo: 'ABCD-2345' })).ok, false); // uno mismo
  assert.equal((await solicitarAmistad('u1', { codigo: 'xx' })).ok, false); // código inválido
});

test('si la otra persona ya te había enviado solicitud, se acepta; si hay bloqueo, no existe', async () => {
  const { filas } = montar({
    usuarios: [yo, lucia, privada],
    amistades: [{ id: 'f0', requesterId: 'u2', addresseeId: 'u1', status: 'PENDING', createdAt: new Date(), respondedAt: null }],
    bloqueos: [{ blockerId: 'u3', blockedId: 'u1' }],
  });
  const r = (await solicitarAmistad('u1', { nombre: 'Lucía' })) as any;
  assert.equal(r.estado, 'AMIGA');
  assert.equal(filas[0]!.status, 'ACCEPTED');
  assert.equal((await solicitarAmistad('u1', { codigo: 'PRVA2345' })).ok, false);
});

test('responder: aceptar convierte en amistad y rechazar descarta sin avisar; luego se puede quitar', async () => {
  const { filas } = montar({
    usuarios: [yo, lucia, privada],
    amistades: [
      { id: 'f1', requesterId: 'u2', addresseeId: 'u1', status: 'PENDING', createdAt: new Date(), respondedAt: null },
      { id: 'f2', requesterId: 'u3', addresseeId: 'u1', status: 'PENDING', createdAt: new Date(), respondedAt: null },
    ],
  });
  assert.equal(((await responderAmistad('u1', 'Lucía', true)) as any).estado, 'AMIGA');
  assert.equal(((await responderAmistad('u1', 'Reservada', false)) as any).estado, 'NINGUNA');
  assert.equal(filas.length, 1);
  const lista = (await getAmistades('u1')) as any;
  assert.deepEqual(lista.amistades.map((a: any) => a.nombre), ['Lucía']);
  assert.match(lista.miCodigo, /^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  assert.equal((await quitarAmistad('u1', 'Lucía')).ok, true);
  assert.equal(filas.length, 0);
  assert.equal((await quitarAmistad('u1', 'Lucía')).ok, false);
});

test('las rutas, la migración y el bloqueo están conectados', () => {
  const router = readFileSync('src/routes/api.router.ts', 'utf8');
  for (const accion of ['amistades', 'buscarPersonas', 'solicitarAmistad', 'responderAmistad', 'cancelarSolicitudAmistad', 'quitarAmistad']) {
    assert.match(router, new RegExp(`case '${accion}'`));
  }
  assert.match(router, /'solicitarAmistad',\s*'responderAmistad'/); // POST_ONLY
  const carpeta = readdirSync('prisma/migrations').find((d) => d.endsWith('_friendships'))!;
  const sql = readFileSync(`prisma/migrations/${carpeta}/migration.sql`, 'utf8');
  assert.match(sql, /CREATE TABLE "Friendship"/);
  assert.match(sql, /AMISTAD_SOLICITUD/);
  assert.match(readFileSync('src/services/moderation.service.ts', 'utf8'), /friendship\.deleteMany/);
});

test('«club en común»: la búsqueda lo avisa y la lista de amistades pone primero a quienes no son de tu club', async () => {
  const ana = { id: 'u4', name: 'Ana' };
  montar({
    usuarios: [yo, lucia, ana],
    amistades: [
      { id: 'f1', requesterId: 'u1', addresseeId: 'u2', status: 'ACCEPTED', createdAt: new Date(), respondedAt: new Date() },
      { id: 'f2', requesterId: 'u1', addresseeId: 'u4', status: 'ACCEPTED', createdAt: new Date(), respondedAt: new Date() },
    ],
    // Ana (u4) y yo compartimos «Club Lunar»; Lucía (u2) no.
    clubes: [
      { clubId: 'c1', clubName: 'Club Lunar', userId: 'u1' },
      { clubId: 'c1', clubName: 'Club Lunar', userId: 'u4' },
    ],
  });
  const lista = (await getAmistades('u1')) as any;
  assert.deepEqual(lista.amistades.map((a: any) => [a.nombre, a.clubEnComun]), [
    ['Lucía', ''],
    ['Ana', 'Club Lunar'],
  ]);
  const busqueda = (await buscarPersonas('u1', 'ana')) as any;
  assert.equal(busqueda.personas[0].clubEnComun, 'Club Lunar');
});
