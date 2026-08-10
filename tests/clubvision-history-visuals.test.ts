import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { enrichClubvisionHistoryRows } from '../src/services/clubvision.service.js';

const row = (overrides: Record<string, unknown> = {}) => ({
  edition: '2026-08',
  winnerTitle: 'Ganadora',
  winnerBookId: null,
  winnerBook: null,
  points: 42,
  secondTitle: 'Segunda',
  thirdTitle: 'Tercera',
  ...overrides,
});

function client(books: Array<Record<string, unknown>>) {
  let calls = 0;
  let query: unknown;
  return {
    value: {
      book: {
        findMany: async (args: unknown) => {
          calls += 1;
          query = args;
          return books;
        },
      },
    } as any,
    calls: () => calls,
    query: () => query,
  };
}

test('la ganadora usa preferentemente la relación directa', async () => {
  const mock = client([
    { id: 'second', title: 'Segunda', coverUrl: '/segunda.jpg', deletedAt: null },
    { id: 'third', title: 'Tercera', coverUrl: '/tercera.jpg', deletedAt: null },
  ]);
  const [result] = await enrichClubvisionHistoryRows([row({
    winnerBookId: 'winner',
    winnerBook: { id: 'winner', coverUrl: '/ganadora.jpg' },
  })], mock.value);
  assert.equal(result.ganadoraBookId, 'winner');
  assert.equal(result.ganadoraCoverUrl, '/ganadora.jpg');
});

test('una ganadora histórica sin ID se resuelve por título normalizado', async () => {
  const mock = client([
    { id: 'winner', title: '  GANADÓRA ', coverUrl: '/ganadora.jpg', deletedAt: null },
  ]);
  const [result] = await enrichClubvisionHistoryRows([
    row({ secondTitle: null, thirdTitle: null }),
  ], mock.value);
  assert.equal(result.ganadoraBookId, 'winner');
  assert.equal(result.ganadoraCoverUrl, '/ganadora.jpg');
});

test('segunda y tercera incluyen ID y portada con una sola consulta masiva', async () => {
  const mock = client([
    { id: 'winner', title: 'Ganadora', coverUrl: '/winner.jpg', deletedAt: null },
    { id: 'second', title: 'Segunda', coverUrl: '/second.jpg', deletedAt: null },
    { id: 'third', title: 'Tercera', coverUrl: '/third.jpg', deletedAt: null },
  ]);
  const results = await enrichClubvisionHistoryRows([row(), row({ edition: '2026-07' })], mock.value);
  assert.equal(mock.calls(), 1);
  assert.ok(mock.query());
  assert.equal(results[0].segundaBookId, 'second');
  assert.equal(results[0].segundaCoverUrl, '/second.jpg');
  assert.equal(results[0].terceraBookId, 'third');
  assert.equal(results[0].terceraCoverUrl, '/third.jpg');
});

test('un libro sin portada conserva el ID y devuelve portada vacía', async () => {
  const mock = client([
    { id: 'winner', title: 'Ganadora', coverUrl: null, deletedAt: null },
  ]);
  const [result] = await enrichClubvisionHistoryRows([
    row({ secondTitle: null, thirdTitle: null }),
  ], mock.value);
  assert.equal(result.ganadoraBookId, 'winner');
  assert.equal(result.ganadoraCoverUrl, '');
});

test('un título ambiguo no se enlaza arbitrariamente', async () => {
  const mock = client([
    { id: 'one', title: 'Ganadora', coverUrl: '/one.jpg', deletedAt: null },
    { id: 'two', title: 'GANADORA', coverUrl: null, deletedAt: null },
  ]);
  const [result] = await enrichClubvisionHistoryRows([
    row({ secondTitle: null, thirdTitle: null }),
  ], mock.value);
  assert.equal(result.ganadoraBookId, '');
  assert.equal(result.ganadoraCoverUrl, '');
});

test('los contratos antiguo y paginado comparten los seis campos visuales', async () => {
  const mock = client([]);
  const [result] = await enrichClubvisionHistoryRows([row()], mock.value);
  assert.deepEqual(
    Object.keys(result).filter((key) => key.includes('BookId') || key.includes('CoverUrl')).sort(),
    [
      'ganadoraBookId', 'ganadoraCoverUrl',
      'segundaBookId', 'segundaCoverUrl',
      'terceraBookId', 'terceraCoverUrl',
    ].sort(),
  );
  const source = await readFile(
    new URL('../src/services/clubvision.service.ts', import.meta.url),
    'utf8',
  );
  assert.match(source, /getHistorialClubvision[\s\S]*return enrichClubvisionHistoryRows\(results\)/);
  assert.match(source, /getHistorialClubvisionPage[\s\S]*items: await enrichClubvisionHistoryRows\(page\.items\)/);
});
