import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';

import { prisma } from '../src/prisma.js';
import { contarReaccionesProgreso } from '../src/utils/reacciones.utils.js';
import {
  getPrivacidadAmistades,
  guardarPrivacidadAmistades,
} from '../src/services/amistades-ver.service.js';

test('las reacciones se cuentan por tipo y salen todos los tipos', () => {
  const r = contarReaccionesProgreso([{ reaction: 'LIKE' }, { reaction: 'LIKE' }, { reaction: 'CLAP' }]);
  assert.equal(r.LIKE, 2);
  assert.equal(r.CLAP, 1);
  assert.equal(r.CRY, 0);
});

test('la privacidad de amistades se guarda y, sin dato, todo está activado', async () => {
  const guardado: Array<Record<string, unknown>> = [];
  Object.defineProperty(prisma, 'user', {
    configurable: true,
    value: {
      update: async ({ data }: { data: Record<string, unknown> }) => { guardado.push(data); return {}; },
      findUnique: async () => null,
    },
  });
  assert.deepEqual(await getPrivacidadAmistades('x'), { leyendo: true, biblioteca: true, resenas: true, deseos: true });
  const r = await guardarPrivacidadAmistades('x', { leyendo: true, biblioteca: false, resenas: false, deseos: false });
  assert.equal(r.ok, true);
  assert.deepEqual(guardado[0], { friendsSeeReading: true, friendsSeeLibrary: false, friendsSeeReviews: false, friendsSeeWishlist: false });
});

test('rutas, migración y reacciones a amistades están conectadas', () => {
  const router = readFileSync('src/routes/api.router.ts', 'utf8');
  for (const accion of ['perfilAmistad', 'actividadAmistades', 'guardarPrivacidadAmistades']) {
    assert.match(router, new RegExp(`case '${accion}'`));
  }
  assert.match(router, /'quitarAmistad',\s*'guardarPrivacidadAmistades'/); // POST_ONLY
  const carpeta = readdirSync('prisma/migrations').find((d) => d.endsWith('_friends_privacy'))!;
  assert.match(readFileSync(`prisma/migrations/${carpeta}/migration.sql`, 'utf8'), /friendsSeeReading/);
  const books = readFileSync('src/services/books.service.ts', 'utf8');
  assert.match(books, /idsAmistadesQueMuestranLectura/);
});

test('el perfil de una amistad enseña su lista de deseos sin datos privados, y nada si no la comparte', async () => {
  let consultaDeseos: any = null;
  const montar = (compartidaDeseos: boolean) => {
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
            friendsSeeReading: false, friendsSeeLibrary: false, friendsSeeReviews: false,
            friendsSeeWishlist: compartidaDeseos,
          },
        },
      ],
    });
    def('library', { findMany: async () => [], count: async () => 0 });
    def('readingCompletion', { findMany: async () => [], count: async () => 0 });
    def('review', { findMany: async () => [] });
    def('progressReaction', { findMany: async () => [], groupBy: async () => [] });
    def('wishlistItem', {
      findMany: async (args: any) => {
        consultaDeseos = args;
        return [{ id: 'w1', bookId: null, title: 'Libro regalo', author: 'Autora', coverUrl: null, format: 'PHYSICAL', priority: 'HIGH' }];
      },
    });
  };
  const { getPerfilAmistad } = await import('../src/services/amistades-ver.service.js');

  montar(true);
  const con: any = await getPerfilAmistad('yo', 'lucía');
  assert.equal(con.compartido.deseos, true);
  assert.deepEqual(con.deseos, [
    { bookId: '', titulo: 'Libro regalo', autor: 'Autora', coverUrl: '', formato: 'PHYSICAL', prioridad: 'HIGH' },
  ]);
  assert.equal(consultaDeseos.where.purchasedAt, null);
  assert.ok(!('price' in consultaDeseos.select) && !('note' in consultaDeseos.select));

  consultaDeseos = null;
  montar(false);
  const sin: any = await getPerfilAmistad('yo', 'lucía');
  assert.equal(sin.compartido.deseos, false);
  assert.deepEqual(sin.deseos, []);
  assert.equal(consultaDeseos, null);
});
