import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';

import { Prisma } from '@prisma/client';

import { prisma } from '../src/prisma.js';
import { liberarReservasEntre, reservarRegalo } from '../src/services/amistades-regalos.service.js';

type Op = {
  duena?: string;
  comparte?: boolean;
  reserva?: string | null;
  comprado?: boolean;
  abiertas?: number;
  carrera?: boolean;
};

function falsear(op: Op = {}) {
  const log: { creadas: any[]; borradas: any[] } = { creadas: [], borradas: [] };
  const def = (m: string, v: unknown) => Object.defineProperty(prisma, m, { configurable: true, value: v });
  def('userBlock', { findMany: async () => [] });
  def('friendship', {
    findMany: async () => [
      {
        requesterId: 'yo',
        addresseeId: 'u1',
        requester: { id: 'yo', name: 'Cris' },
        addressee: {
          id: 'u1', name: 'Lucía', avatarUrl: null, bio: null, readerPersonality: null,
          friendsSeeReading: true, friendsSeeLibrary: true, friendsSeeReviews: true,
          friendsSeeWishlist: op.comparte !== false,
        },
      },
    ],
  });
  def('wishlistItem', {
    findUnique: async () => ({
      id: 'w1',
      userId: op.duena ?? 'u1',
      purchasedAt: op.comprado ? new Date() : null,
      reservation: op.reserva ? { reservedById: op.reserva } : null,
    }),
  });
  def('wishlistReservation', {
    count: async () => op.abiertas ?? 0,
    create: async ({ data }: any) => {
      if (op.carrera) {
        throw new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' });
      }
      log.creadas.push(data);
      return data;
    },
    deleteMany: async ({ where }: any) => { log.borradas.push(where); return { count: 1 }; },
  });
  return log;
}

test('una amistad reserva un regalo libre', async () => {
  const log = falsear();
  const r: any = await reservarRegalo('yo', 'w1', true);
  assert.equal(r.ok, true);
  assert.deepEqual(log.creadas, [{ wishlistItemId: 'w1', reservedById: 'yo' }]);
});

test('no se reserva si ya lo tiene otra amistad, ni en carrera, ni si no comparte la lista, ni lo propio, ni lo comprado', async () => {
  let log = falsear({ reserva: 'otra' });
  assert.equal(((await reservarRegalo('yo', 'w1', true)) as any).ok, false);
  assert.equal(log.creadas.length, 0);
  log = falsear({ carrera: true });
  assert.equal(((await reservarRegalo('yo', 'w1', true)) as any).ok, false);
  falsear({ comparte: false });
  assert.equal(((await reservarRegalo('yo', 'w1', true)) as any).ok, false);
  falsear({ duena: 'yo' });
  assert.equal(((await reservarRegalo('yo', 'w1', true)) as any).ok, false);
  falsear({ comprado: true });
  assert.equal(((await reservarRegalo('yo', 'w1', true)) as any).ok, false);
  log = falsear({ abiertas: 50 });
  assert.equal(((await reservarRegalo('yo', 'w1', true)) as any).ok, false);
  assert.equal(log.creadas.length, 0);
});

test('reservar dos veces es inocuo y solo quien reservó puede deshacerlo', async () => {
  let log = falsear({ reserva: 'yo' });
  assert.equal(((await reservarRegalo('yo', 'w1', true)) as any).ok, true);
  assert.equal(log.creadas.length, 0);
  log = falsear({ reserva: 'yo' });
  assert.equal(((await reservarRegalo('yo', 'w1', false)) as any).ok, true);
  assert.deepEqual(log.borradas, [{ wishlistItemId: 'w1', reservedById: 'yo' }]);
  log = falsear({ reserva: 'otra' });
  assert.equal(((await reservarRegalo('yo', 'w1', false)) as any).ok, true);
  assert.equal(log.borradas.length, 0);
});

test('la sorpresa: ningún otro servicio ni consulta de la dueña toca las reservas', () => {
  const permitidos = new Set(['amistades-regalos.service.ts', 'amistades-ver.service.ts']);
  const todos = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? todos(`${dir}/${e.name}`) : [`${dir}/${e.name}`],
    );
  const tocan = todos('src').filter(
    (f) => f.endsWith('.ts') && /reservation|WishlistReservation/.test(readFileSync(f, 'utf8')),
  );
  assert.deepEqual(
    tocan.map((f) => f.split('/').pop()).filter((n) => !permitidos.has(n!)),
    [],
  );
});

test('rutas y migración están conectadas, y el perfil enseña quién lo reservó solo como sí/no', () => {
  const router = readFileSync('src/routes/api.router.ts', 'utf8');
  assert.match(router, /case 'reservarRegalo'/);
  assert.match(router, /'comentarProgreso',\s*'reservarRegalo'/);
  const ver = readFileSync('src/services/amistades-ver.service.ts', 'utf8');
  assert.match(ver, /reservado: Boolean\(d\.reservation\)/);
  assert.match(ver, /reservadoPorMi: d\.reservation\?\.reservedById === yo/);
  assert.doesNotMatch(ver, /reservedBy:\s*\{/); // nunca el nombre de quien reserva
  assert.match(
    readFileSync('prisma/migrations/20261017100000_wishlist_reservations/migration.sql', 'utf8'),
    /CREATE TABLE "WishlistReservation"/,
  );
});

test('quitar tu reserva siempre se puede, aunque ya no seáis amistades o haya dejado de compartir la lista', async () => {
  const log = falsear({ reserva: 'yo', comparte: false });
  assert.equal(((await reservarRegalo('yo', 'w1', false)) as any).ok, true);
  assert.deepEqual(log.borradas, [{ wishlistItemId: 'w1', reservedById: 'yo' }]);
});

test('al quitar la amistad o bloquear se liberan las reservas entre las dos, en los dos sentidos', async () => {
  let consulta: any = null;
  Object.defineProperty(prisma, 'wishlistReservation', {
    configurable: true,
    value: { deleteMany: async (args: any) => { consulta = args; return { count: 2 }; } },
  });
  await liberarReservasEntre('a', 'b');
  assert.deepEqual(consulta.where.OR, [
    { reservedById: 'a', wishlistItem: { userId: 'b' } },
    { reservedById: 'b', wishlistItem: { userId: 'a' } },
  ]);
  assert.match(readFileSync('src/services/amistades.service.ts', 'utf8'), /liberarReservasEntre\(userId, otra\.id\)/);
  assert.match(readFileSync('src/services/moderation.service.ts', 'utf8'), /liberarReservasEntre\(blockerId, blocked\.id\)/);
});
