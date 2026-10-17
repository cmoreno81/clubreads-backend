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
    { id: 'w1', reservado: false, reservadoPorMi: false, bookId: '', titulo: 'Libro regalo', autor: 'Autora', coverUrl: '', formato: 'PHYSICAL', prioridad: 'HIGH' },
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

test('en el perfil de una amistad, la reseña con spoilers no enseña su texto y la normal sí', async () => {
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
          friendsSeeReading: false, friendsSeeLibrary: false, friendsSeeReviews: true, friendsSeeWishlist: false,
        },
      },
    ],
  });
  def('library', { findMany: async () => [], count: async () => 0 });
  def('readingCompletion', { findMany: async () => [], count: async () => 0 });
  def('progressReaction', { findMany: async () => [], groupBy: async () => [] });
  def('wishlistItem', { findMany: async () => [] });
  const fecha = new Date(2026, 9, 1);
  def('review', {
    findMany: async () => [
      { id: 'r1', rating: 4, review: 'Se muere al final', containsSpoilers: true, createdAt: fecha, book: { id: 'b1', title: 'Con spoilers', coverUrl: null } },
      { id: 'r2', rating: 5, review: 'Preciosa, os la recomiendo', containsSpoilers: false, createdAt: fecha, book: { id: 'b2', title: 'Normal', coverUrl: null } },
    ],
  });
  const { getPerfilAmistad } = await import('../src/services/amistades-ver.service.js');
  const perfil: any = await getPerfilAmistad('yo', 'Lucía');
  const por = Object.fromEntries(perfil.resenas.map((r: any) => [r.titulo, r]));
  assert.equal(por['Con spoilers'].contieneSpoilers, true);
  assert.equal(por['Con spoilers'].texto, ''); // nunca el texto
  assert.equal(por['Normal'].texto, 'Preciosa, os la recomiendo');
});

test('un deseo sin portada propia usa la del libro del catálogo (y la autoría); la propia gana', async () => {
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
          friendsSeeReading: false, friendsSeeLibrary: false, friendsSeeReviews: false, friendsSeeWishlist: true,
        },
      },
    ],
  });
  def('library', { findMany: async () => [], count: async () => 0 });
  def('readingCompletion', { findMany: async () => [], count: async () => 0 });
  def('review', { findMany: async () => [] });
  def('progressReaction', { findMany: async () => [], groupBy: async () => [] });
  def('wishlistItem', {
    findMany: async () => [
      { id: 'a', bookId: 'b1', title: 'La torre oscura', author: null, coverUrl: null, format: 'PHYSICAL', priority: 'HIGH',
        book: { coverUrl: 'https://x/torre.jpg', author: { name: 'Stephen King' } } },
      { id: 'b', bookId: 'b2', title: 'Con portada propia', author: 'Ella', coverUrl: 'https://x/propia.jpg', format: 'PHYSICAL', priority: 'LOW',
        book: { coverUrl: 'https://x/otra.jpg', author: { name: 'Otra' } } },
      { id: 'c', bookId: null, title: 'Sin libro', author: null, coverUrl: null, format: 'PHYSICAL', priority: 'LOW', book: null },
    ],
  });
  const { getPerfilAmistad } = await import('../src/services/amistades-ver.service.js');
  const r: any = await getPerfilAmistad('yo', 'lucía');
  assert.deepEqual(
    r.deseos.map((d: any) => [d.titulo, d.coverUrl, d.autor]),
    [
      ['La torre oscura', 'https://x/torre.jpg', 'Stephen King'],
      ['Con portada propia', 'https://x/propia.jpg', 'Ella'],
      ['Sin libro', '', ''],
    ],
  );
});
