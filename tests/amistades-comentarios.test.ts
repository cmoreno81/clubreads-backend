import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { prisma } from '../src/prisma.js';
import { limpiarComentarioProgreso } from '../src/services/amistades-core.js';
import {
  borrarComentarioProgreso,
  comentarProgreso,
  getComentariosProgreso,
} from '../src/services/amistades-comentarios.service.js';

type Opciones = { duenaComparte?: boolean; amigas?: boolean; hoy?: number; bloqueadas?: string[] };

function falsear(op: Opciones = {}) {
  const creados: Array<Record<string, any>> = [];
  const notificaciones: Array<Record<string, any>> = [];
  const borrados: Array<Record<string, any>> = [];
  let filtroLectura: any = null;
  const def = (m: string, v: unknown) => Object.defineProperty(prisma, m, { configurable: true, value: v });
  def('library', {
    findUnique: async () => ({ id: 'l1', userId: 'dueña', book: { id: 'b1', title: 'Yesteryear' } }),
  });
  def('userBlock', {
    findMany: async () => (op.bloqueadas ?? []).map((id) => ({ blockerId: 'yo', blockedId: id })),
  });
  def('friendship', {
    findMany: async () =>
      op.amigas === false
        ? []
        : [
            {
              requesterId: 'yo',
              addresseeId: 'dueña',
              requester: { id: 'yo', name: 'Cris' },
              addressee: {
                id: 'dueña', name: 'Lucía', avatarUrl: null, bio: null, readerPersonality: null,
                friendsSeeReading: op.duenaComparte !== false, friendsSeeLibrary: true,
                friendsSeeReviews: true, friendsSeeWishlist: true,
              },
            },
          ],
  });
  def('user', { findUnique: async () => ({ id: 'yo', name: 'Cris' }), findMany: async () => [] });
  def('notificationPreference', { findMany: async () => [] });
  def('notification', { create: async ({ data }: any) => { notificaciones.push(data); return data; } });
  def('progressComment', {
    count: async () => op.hoy ?? 0,
    create: async ({ data }: any) => { creados.push(data); return { id: 'c1', createdAt: new Date() }; },
    findMany: async (args: any) => {
      filtroLectura = args;
      return [
        { id: 'c2', text: 'segundo', createdAt: new Date(2026, 9, 2), userId: 'dueña', user: { name: 'Lucía', avatarUrl: null } },
        { id: 'c1', text: 'primero', createdAt: new Date(2026, 9, 1), userId: 'yo', user: { name: 'Cris', avatarUrl: null } },
      ];
    },
    findUnique: async () => ({ id: 'c1', userId: 'yo', deletedAt: null, library: { userId: 'dueña' } }),
    update: async (args: any) => { borrados.push(args); return {}; },
  });
  return { creados, notificaciones, borrados, filtro: () => filtroLectura };
}

test('el comentario se limpia y se recorta', () => {
  assert.equal(limpiarComentarioProgreso('  hola   mundo \n\n\n  adiós '), 'hola mundo\nadiós');
  assert.equal(limpiarComentarioProgreso(null), '');
  assert.equal(limpiarComentarioProgreso('a'.repeat(900)).length, 300);
});

test('una amistad comenta y la dueña recibe el aviso', async () => {
  const f = falsear();
  const r: any = await comentarProgreso('yo', 'l1', '¡Qué ganas de leerlo!');
  assert.equal(r.ok, true);
  assert.equal(f.creados[0].text, '¡Qué ganas de leerlo!');
  assert.equal(f.notificaciones[0].userId, 'dueña');
  assert.equal(f.notificaciones[0].tipo, 'PROGRESO_COMENTARIO');
  assert.match(f.notificaciones[0].mensaje, /Cris sobre «Yesteryear»: ¡Qué ganas de leerlo!/);
  assert.equal(JSON.parse(f.notificaciones[0].extra).libraryId, 'l1');
});

test('sin amistad, sin permiso de lectura, vacío o pasado de tope, no se comenta', async () => {
  let f = falsear({ amigas: false });
  assert.equal(((await comentarProgreso('yo', 'l1', 'hola')) as any).ok, false);
  f = falsear({ duenaComparte: false });
  assert.equal(((await comentarProgreso('yo', 'l1', 'hola')) as any).ok, false);
  f = falsear();
  assert.equal(((await comentarProgreso('yo', 'l1', '   ')) as any).ok, false);
  f = falsear({ hoy: 60 });
  assert.equal(((await comentarProgreso('yo', 'l1', 'hola')) as any).ok, false);
  assert.equal(f.creados.length, 0);
});

test('la lista sale de más antiguo a más reciente, sin bloqueadas y con quién puede borrar', async () => {
  const f = falsear({ bloqueadas: ['x9'] });
  const r: any = await getComentariosProgreso('yo', 'l1');
  assert.equal(r.ok, true);
  assert.deepEqual(r.comentarios.map((c: any) => c.id), ['c1', 'c2']);
  assert.equal(r.comentarios[0].esMio, true);
  assert.equal(r.comentarios[0].puedoBorrar, true);
  assert.equal(r.comentarios[1].puedoBorrar, false);
  assert.deepEqual(f.filtro().where.userId.notIn, ['x9']);
  assert.equal(f.filtro().where.deletedAt, null);
});

test('borra quien lo escribió y la dueña; el resto no', async () => {
  let f = falsear();
  assert.equal(((await borrarComentarioProgreso('yo', 'c1')) as any).ok, true);
  assert.ok(f.borrados[0].data.deletedAt instanceof Date);
  f = falsear();
  assert.equal(((await borrarComentarioProgreso('otra', 'c1')) as any).ok, false);
  assert.equal(f.borrados.length, 0);
});

test('rutas, denuncia y migración están conectadas', () => {
  const router = readFileSync('src/routes/api.router.ts', 'utf8');
  for (const a of ['comentariosProgreso', 'comentarProgreso', 'borrarComentarioProgreso']) {
    assert.match(router, new RegExp(`case '${a}'`));
  }
  for (const a of ['comentarProgreso', 'borrarComentarioProgreso']) assert.match(router, new RegExp(`'${a}',`)); // POST_ONLY
  assert.match(readFileSync('src/services/moderation.service.ts', 'utf8'), /comentarioProgreso/);
  assert.match(
    readFileSync('prisma/migrations/20261016140000_progress_comments/migration.sql', 'utf8'),
    /CREATE TABLE "ProgressComment"/,
  );
});
