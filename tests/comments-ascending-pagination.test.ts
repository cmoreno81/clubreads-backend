import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  ascendingCursorFilter,
  decodeCursor,
  pageFromRows,
} from '../src/utils/cursor-pagination.js';

type Comment = { id: string; createdAt: Date };
const sharedDate = new Date('2026-08-09T10:00:00.000Z');
const comments: Comment[] = [
  { id: 'a', createdAt: new Date('2026-08-08T10:00:00.000Z') },
  { id: 'b', createdAt: sharedDate },
  { id: 'c', createdAt: sharedDate },
  { id: 'd', createdAt: new Date('2026-08-10T10:00:00.000Z') },
];

function page(cursor?: { value: string; id: string }) {
  const value = cursor ? new Date(cursor.value) : null;
  const rows = comments.filter((comment) => !cursor ||
    comment.createdAt > value! ||
    (comment.createdAt.getTime() === value!.getTime() && comment.id > cursor.id));
  return pageFromRows(rows.slice(0, 3), 2, (comment) => ({
    value: comment.createdAt.toISOString(),
    id: comment.id,
  }));
}

test('la primera página empieza por el comentario más antiguo', () => {
  const result = page();
  assert.deepEqual(result.items.map(({ id }) => id), ['a', 'b']);
  assert.equal(result.hasMore, true);
  assert.ok(result.nextCursor);
});

test('la siguiente página continúa cronológicamente sin duplicar fechas iguales', () => {
  const first = page();
  const second = page(decodeCursor(first.nextCursor!));
  const ids = [...first.items, ...second.items].map(({ id }) => id);
  assert.deepEqual(second.items.map(({ id }) => id), ['c', 'd']);
  assert.deepEqual(ids, ['a', 'b', 'c', 'd']);
  assert.equal(new Set(ids).size, comments.length);
  assert.equal(second.hasMore, false);
});

test('la consulta paginada y las respuestas usan orden cronológico estable', async () => {
  const source = await readFile(
    new URL('../src/services/readings.service.ts', import.meta.url),
    'utf8',
  );
  const paginated = source.slice(source.indexOf('export async function getComentariosLecturaPage'));
  assert.match(paginated, /ascendingCursorFilter\('createdAt', pagination\.cursor\)/);
  assert.match(paginated, /orderBy: \[\{ createdAt: 'asc' \}, \{ id: 'asc' \}\]/);
  assert.match(
    paginated,
    /replies:[\s\S]*?orderBy: \[\{ createdAt: 'asc' \}, \{ id: 'asc' \}\]/,
  );
  assert.doesNotMatch(
    paginated.slice(0, paginated.indexOf('export async function enviarComentarioLectura')),
    /descendingCursorFilter/,
  );
});

test('el contrato antiguo conserva el mismo orden que el paginado', async () => {
  const source = await readFile(
    new URL('../src/services/readings.service.ts', import.meta.url),
    'utf8',
  );
  const legacy = source.slice(
    source.indexOf('export async function getComentariosLectura('),
    source.indexOf('export async function getComentariosLecturaPage'),
  );
  const stableAscending = /orderBy: \[\{ createdAt: 'asc' \}, \{ id: 'asc' \}\]/g;
  assert.equal(legacy.match(stableAscending)?.length, 2);
  assert.deepEqual(
    ascendingCursorFilter('createdAt', {
      value: sharedDate.toISOString(), id: 'b',
    }),
    {
      OR: [
        { createdAt: { gt: sharedDate } },
        { createdAt: sharedDate, id: { gt: 'b' } },
      ],
    },
  );
});

test('guardar devuelve el comentario creado sin recargar la conversación', async () => {
  const source = await readFile(
    new URL('../src/services/readings.service.ts', import.meta.url),
    'utf8',
  );
  const insertion = source.slice(
    source.indexOf('export async function enviarComentarioLectura'),
    source.indexOf('export async function responderComentarioLectura'),
  );

  assert.match(insertion, /const created = await prisma\.comment\.create/);
  assert.match(insertion, /return \{[\s\S]*ok: true,[\s\S]*comentario: \{/);
  for (const field of [
    'id', 'libro', 'capitulo', 'usuario', 'avatarUrl', 'fecha', 'comentario',
    'tipo', 'color', 'likes', 'reacciones', 'miReaccion', 'miLike', 'esMio',
    'editado', 'eliminado', 'respuestas',
  ]) {
    assert.match(insertion, new RegExp(`\\b${field}:`));
  }
  assert.doesNotMatch(insertion, /prisma\.comment\.findMany/);
});
