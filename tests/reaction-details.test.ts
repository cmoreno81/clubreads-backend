import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { ReactionType } from '@prisma/client';

import { groupReactionDetails } from '../src/services/reaction-details.service.js';

const [service, router, readings, books] = await Promise.all([
  readFile(new URL('../src/services/reaction-details.service.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/routes/api.router.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/services/readings.service.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/services/books.service.ts', import.meta.url), 'utf8'),
]);

const rows = [
  {
    id: 'reaction-1',
    reaction: ReactionType.LIKE,
    createdAt: new Date('2026-08-01T09:00:00.000Z'),
    user: { id: 'bea', name: 'Bea', avatarUrl: null },
  },
  {
    id: 'reaction-2',
    reaction: ReactionType.CLAP,
    createdAt: new Date('2026-08-01T10:00:00.000Z'),
    user: { id: 'current', name: 'Cristina', avatarUrl: '/avatar.png' },
  },
  {
    id: 'reaction-3',
    reaction: ReactionType.LIKE,
    createdAt: new Date('2026-08-01T11:00:00.000Z'),
    user: { id: 'ana', name: 'Ana', avatarUrl: '' },
  },
];

test('agrupa varias reacciones de comentario o respuesta y permite filtrar por emoji', () => {
  const result = groupReactionDetails(rows, 'current');
  assert.equal(result.total, 3);
  assert.deepEqual(result.grupos.map(({ reaccion, usuarios }) => [reaccion, usuarios.length]), [
    [ReactionType.LIKE, 2],
    [ReactionType.CLAP, 1],
  ]);
  assert.deepEqual(result.grupos.find(({ reaccion }) => reaccion === ReactionType.LIKE)?.usuarios.map(({ nombre }) => nombre), ['Bea', 'Ana']);
});

test('el detalle de progreso conserva orden estable e identifica a Tú', () => {
  const result = groupReactionDetails(rows, 'current');
  assert.deepEqual(result.grupos.flatMap(({ usuarios }) => usuarios).find(({ esTu }) => esTu), {
    id: 'current',
    nombre: 'Cristina',
    avatarUrl: '/avatar.png',
    esTu: true,
    fecha: '2026-08-01T10:00:00.000Z',
  });
});

test('comentarios, respuestas y progresos se limitan al club activo y los inexistentes no filtran datos', () => {
  assert.match(service, /conversation: \{ reading: \{ clubId: club\.id \} \}/);
  assert.match(service, /clubMemberships: \{ some: \{ clubId: club\.id \} \}/);
  assert.match(service, /rows = target\?\.(?:likes|progressReactions) \?\? null/);
  assert.match(service, /REACTION_TARGET_NOT_FOUND/);
});

test('abrir el detalle es autenticado, de solo lectura y no modifica reacciones', () => {
  assert.match(router, /case 'detalleReacciones':[\s\S]*?!req\.auth[\s\S]*?handleReactionDetails/);
  assert.doesNotMatch(service, /\.(?:create|update|upsert|delete|deleteMany)\(/);
  assert.doesNotMatch(router, /POST_ONLY_ACTIONS[\s\S]{0,1600}'detalleReacciones'/);
});

test('el endpoint no incorpora identidades en cargas de dashboard o conversación', () => {
  assert.match(service, /user: \{ select: \{ id: true, name: true, avatarUrl: true \} \}/);
  assert.doesNotMatch(service, /email|passwordHash/);
});

test('los botones habituales conservan añadir, cambiar y quitar reacciones', () => {
  assert.match(readings, /existing\?\.reaction === reaction[\s\S]*?like\.delete[\s\S]*?like\.update[\s\S]*?like\.create/);
  assert.match(books, /current\?\.reaction === reaction[\s\S]*?progressReaction\.delete[\s\S]*?progressReaction\.upsert/);
});
