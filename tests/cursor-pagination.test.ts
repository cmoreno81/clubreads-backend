import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { NotificationType } from '@prisma/client';

import { getNotificacionesPage } from '../src/services/notifications.service.js';
import {
  ascendingCursorFilter,
  PaginationError,
  decodeCursor,
  descendingCursorFilter,
  pageFromRows,
  parsePagination,
} from '../src/utils/cursor-pagination.js';

type Row = { id: string; createdAt: Date };

const sameDate = new Date('2026-08-09T10:00:00.000Z');
const rows: Row[] = [
  { id: 'd', createdAt: new Date('2026-08-10T10:00:00.000Z') },
  { id: 'c', createdAt: sameDate },
  { id: 'b', createdAt: sameDate },
  { id: 'a', createdAt: new Date('2026-08-08T10:00:00.000Z') },
];

function after(cursor?: { value: string; id: string }) {
  if (!cursor) return rows;
  const value = new Date(cursor.value).getTime();
  return rows.filter((row) =>
    row.createdAt.getTime() < value ||
    (row.createdAt.getTime() === value && row.id < cursor.id));
}

function page(cursor?: { value: string; id: string }) {
  return pageFromRows(after(cursor).slice(0, 3), 2, (row) => ({
    value: row.createdAt.toISOString(),
    id: row.id,
  }));
}

test('primera página usa limit + 1 y genera cursor', () => {
  const first = page();
  assert.deepEqual(first.items.map(({ id }) => id), ['d', 'c']);
  assert.equal(first.hasMore, true);
  assert.ok(first.nextCursor);
});

test('página siguiente no duplica ni omite elementos con la misma fecha', () => {
  const first = page();
  const second = page(decodeCursor(first.nextCursor!));
  const ids = [...first.items, ...second.items].map(({ id }) => id);
  assert.deepEqual(second.items.map(({ id }) => id), ['b', 'a']);
  assert.deepEqual(ids, ['d', 'c', 'b', 'a']);
  assert.equal(new Set(ids).size, rows.length);
  assert.equal(second.hasMore, false);
  assert.equal(second.nextCursor, null);
});

test('el filtro incluye fecha e id como desempate determinista', () => {
  assert.deepEqual(
    descendingCursorFilter('createdAt', {
      value: sameDate.toISOString(),
      id: 'c',
    }),
    {
      OR: [
        { createdAt: { lt: sameDate } },
        { createdAt: sameDate, id: { lt: 'c' } },
      ],
    },
  );
});

test('el filtro ascendente continúa por fecha y después por ID', () => {
  assert.deepEqual(
    ascendingCursorFilter('createdAt', {
      value: sameDate.toISOString(),
      id: 'b',
    }),
    {
      OR: [
        { createdAt: { gt: sameDate } },
        { createdAt: sameDate, id: { gt: 'b' } },
      ],
    },
  );
});

test('rechaza cursor inválido y límites fuera de 1..50', () => {
  assert.throws(() => parsePagination({ cursor: 'no-es-un-cursor' }), PaginationError);
  assert.throws(() => parsePagination({ limit: '0' }), PaginationError);
  assert.throws(() => parsePagination({ limit: '51' }), PaginationError);
  assert.throws(() => parsePagination({ limit: '1.5' }), PaginationError);
  assert.throws(() => parsePagination({ limit: '1e1' }), PaginationError);
  assert.throws(() => parsePagination({ limit: ['10'] }), PaginationError);
  assert.throws(
    () => decodeCursor(Buffer.from(JSON.stringify({ v: 1, value: 'no-fecha', id: 'x' })).toString('base64url')),
    PaginationError,
  );
  assert.equal(parsePagination({ limit: '50' }).limit, 50);
});

test('notificaciones filtra siempre por la usuaria autenticada', async () => {
  let query: any;
  const client = {
    notification: {
      async findMany(args: any) {
        query = args;
        return [{
          id: 'n1',
          tipo: NotificationType.LECTURA_NUEVA,
          titulo: 'Nueva lectura',
          mensaje: 'Mensaje',
          leida: false,
          clubId: 'club-a',
          bookId: null,
          extra: null,
          createdAt: sameDate,
        }];
      },
    },
  };
  const result = await getNotificacionesPage(
    'user-a',
    { limit: 10 },
    client,
  );
  assert.equal(query.where.userId, 'user-a');
  assert.equal(query.take, 11);
  assert.deepEqual(query.orderBy, [
    { createdAt: 'desc' },
    { id: 'desc' },
  ]);
  assert.deepEqual(result.items.map(({ id }) => id), ['n1']);
});

test('los controladores conservan la rama de respuesta antigua', async () => {
  const sources = await Promise.all([
    'notifications.controller.ts',
    'readings.controller.ts',
    'catalog.controller.ts',
    'books.controller.ts',
    'clubvision.controller.ts',
    'perfil.controller.ts',
  ].map((file) => readFile(new URL(`../src/controllers/${file}`, import.meta.url), 'utf8')));
  for (const source of sources) {
    assert.match(source, /hasExplicitPagination\(req\.query\)/);
  }
  assert.match(sources[0]!, /getNotificaciones\(req\.auth!\.userId\)/);
  assert.match(sources[1]!, /getComentariosLectura\(/);
  assert.match(sources[1]!, /getConversacionesLibro\(/);
  assert.match(sources[2]!, /getGeneralCatalog\(requestUserName\(req\)\)/);
  assert.match(sources[3]!, /getLibrosFinalizados\(/);
  assert.match(sources[4]!, /getHistorialClubvision\(/);
  assert.match(sources[5]!, /getPerfilUsuario\(/);
});

test('las consultas paginadas mantienen aislamiento de club', async () => {
  const sources = await Promise.all([
    readFile(new URL('../src/services/readings.service.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/services/books.service.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/services/clubvision.service.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/services/perfil.service.ts', import.meta.url), 'utf8'),
  ]);
  assert.match(sources[0]!, /getConversacionesLibroPage[\s\S]*clubId: club\.id/);
  assert.match(sources[0]!, /getComentariosLecturaPage[\s\S]*clubId: club\.id/);
  assert.match(sources[1]!, /getLibrosFinalizadosPage[\s\S]*clubId: club\.id/);
  assert.match(sources[2]!, /getHistorialClubvisionPage[\s\S]*clubId: club\.id/);
  assert.match(sources[3]!, /getPerfilHistorialPage[\s\S]*clubMemberships/);
});
