import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { prisma } from '../src/prisma.js';
import { limpiarMensajeRecomendacion } from '../src/services/amistades-core.js';
import { recomendarLibro } from '../src/services/amistades-recomendar.service.js';

function falsear(opciones: { previas?: string[]; hoy?: number; amistades?: string[] } = {}) {
  const creadas: Array<Record<string, any>> = [];
  const amistades = opciones.amistades ?? ['Lucía', 'Marta'];
  const def = (modelo: string, valor: unknown) =>
    Object.defineProperty(prisma, modelo, { configurable: true, value: valor });
  def('user', {
    findUnique: async () => ({ id: 'yo', name: 'Cris' }),
    findMany: async () => [],
  });
  def('book', { findUnique: async ({ where }: any) => (where.id === 'b1' ? { id: 'b1', title: 'Yesteryear' } : null) });
  def('friendship', {
    findMany: async () =>
      amistades.map((n, i) => ({
        requesterId: 'yo',
        addresseeId: `u${i}`,
        requester: { id: 'yo', name: 'Cris' },
        addressee: { id: `u${i}`, name: n },
      })),
  });
  def('notification', {
    count: async () => opciones.hoy ?? 0,
    findMany: async () => (opciones.previas ?? []).map((userId) => ({ userId })),
    create: async ({ data }: any) => { creadas.push(data); return data; },
  });
  def('notificationPreference', { findMany: async () => [] });
  return creadas;
}

test('el mensaje personal se limpia y se recorta', () => {
  assert.equal(limpiarMensajeRecomendacion('  Te va\n a  encantar  '), 'Te va a encantar');
  assert.equal(limpiarMensajeRecomendacion(undefined), '');
  assert.equal(limpiarMensajeRecomendacion('a'.repeat(300)).length, 140);
});

test('recomendar avisa solo a las amistades pedidas, con el mensaje', async () => {
  const creadas = falsear();
  const r: any = await recomendarLibro('yo', {
    bookId: 'b1',
    nombres: ['lucía', 'Desconocida'],
    mensaje: 'Me ha encantado',
  });
  assert.equal(r.ok, true);
  assert.equal(r.enviadas, 1);
  assert.equal(creadas.length, 1);
  assert.equal(creadas[0].userId, 'u0');
  assert.equal(creadas[0].tipo, 'LIBRO_RECOMENDADO');
  assert.equal(creadas[0].bookId, 'b1');
  assert.match(creadas[0].mensaje, /Cris te recomienda «Yesteryear»: «Me ha encantado»/);
});

test('invitar a leer juntas cambia el texto', async () => {
  const creadas = falsear();
  await recomendarLibro('yo', { bookId: 'b1', nombres: ['Marta'], juntas: true });
  assert.match(creadas[0].titulo, /¿Lo leemos a la vez\?/);
  assert.match(creadas[0].mensaje, /te propone leer «Yesteryear» a la vez/);
});

test('no repite en 30 días, no avisa a quien no es amistad y respeta el tope diario', async () => {
  let creadas = falsear({ previas: ['u0'] });
  let r: any = await recomendarLibro('yo', { bookId: 'b1', nombres: ['Lucía', 'Marta'] });
  assert.equal(r.enviadas, 1);
  assert.equal(r.yaRecomendado, 1);
  assert.equal(creadas[0].userId, 'u1');

  falsear();
  r = await recomendarLibro('yo', { bookId: 'b1', nombres: ['Extraña'] });
  assert.equal(r.ok, false);

  creadas = falsear({ hoy: 40 });
  r = await recomendarLibro('yo', { bookId: 'b1', nombres: ['Lucía'] });
  assert.equal(r.ok, false);
  assert.equal(creadas.length, 0);

  falsear();
  r = await recomendarLibro('yo', { bookId: 'nope', nombres: ['Lucía'] });
  assert.equal(r.ok, false);
});

test('la acción está conectada: ruta POST, validación y migración', () => {
  const router = readFileSync('src/routes/api.router.ts', 'utf8');
  assert.match(router, /case 'recomendarLibro'/);
  assert.match(router, /'guardarPrivacidadAmistades',\s*'recomendarLibro'/);
  assert.match(readFileSync('src/validation/api-validation.ts', 'utf8'), /recomendarLibro: body/);
  assert.match(
    readFileSync('prisma/migrations/20261016100000_book_recommendations/migration.sql', 'utf8'),
    /ADD VALUE IF NOT EXISTS 'LIBRO_RECOMENDADO'/,
  );
});
