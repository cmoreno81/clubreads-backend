import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { ReadingType } from '@prisma/client';

import { transitionClubvisionToReading } from '../src/services/clubvision.service.js';
import { shouldShowActiveReading } from '../src/services/readings.service.js';

function fakeTransaction() {
  const state = {
    clubvision: { id: 'cv', status: 'RESULTADOS', winnerBookId: 'winner-book' },
    readings: [
      {
        id: 'old-reading', clubId: 'club', bookId: 'old-book', status: 'ACTIVE',
        type: 'CLUBVISION', chapters: 89, hasPrologue: true, hasEpilogue: true,
        conversations: [{ id: 'conversation', comments: Array.from({ length: 116 }, (_, i) => ({ id: `comment-${i}` })) }],
      },
      {
        id: 'winner-reading', clubId: 'club', bookId: 'winner-book', status: 'ACTIVE',
        type: 'FREE', chapters: 31, hasPrologue: false, hasEpilogue: true,
        conversations: [{ id: 'winner-conversation', comments: [{ id: 'winner-comment' }] }],
      },
    ],
  };
  const matches = (reading: any, where: any) =>
    (!where.clubId || reading.clubId === where.clubId) &&
    (!where.bookId || reading.bookId === where.bookId) &&
    (!where.status || reading.status === where.status) &&
    (!where.type || reading.type === where.type) &&
    (!where.id?.not || reading.id !== where.id.not);
  const tx = {
    $queryRaw: async () => [],
    clubvision: {
      findUnique: async () => ({ status: state.clubvision.status }),
      update: async ({ data }: any) => Object.assign(state.clubvision, data),
    },
    reading: {
      findFirst: async ({ where }: any) => state.readings.find((reading) => matches(reading, where)) ?? null,
      updateMany: async ({ where, data }: any) => {
        const selected = state.readings.filter((reading) => matches(reading, where));
        selected.forEach((reading) => Object.assign(reading, data));
        return { count: selected.length };
      },
      update: async ({ where, data }: any) => {
        const reading = state.readings.find(({ id }) => id === where.id)!;
        Object.assign(reading, data);
        return reading;
      },
    },
  };
  return { state, tx };
}

test('la oficial anterior pasa a FREE conservando ID, configuración y 116 comentarios', async () => {
  const { state, tx } = fakeTransaction();
  const previous = structuredClone(state.readings[0]);
  const result = await transitionClubvisionToReading(tx as never, {
    clubvisionId: 'cv', clubId: 'club', edition: '2026-08', winnerBookId: 'winner-book',
  });
  const old = state.readings[0];
  assert.equal(result.transitioned, true);
  assert.equal(old.type, 'FREE');
  assert.equal(old.id, previous.id);
  assert.equal(old.status, 'ACTIVE');
  assert.equal(old.chapters, previous.chapters);
  assert.equal(old.hasPrologue, previous.hasPrologue);
  assert.equal(old.hasEpilogue, previous.hasEpilogue);
  assert.deepEqual(old.conversations, previous.conversations);
  assert.equal(old.conversations[0]?.comments.length, 116);
  assert.equal(shouldShowActiveReading(ReadingType.FREE, 2), true);
});

test('una lectura FREE de la ganadora se promociona sin perder datos y queda como única oficial', async () => {
  const { state, tx } = fakeTransaction();
  const winnerBefore = structuredClone(state.readings[1]);
  const result = await transitionClubvisionToReading(tx as never, {
    clubvisionId: 'cv', clubId: 'club', edition: '2026-08', winnerBookId: 'winner-book',
  });
  const winner = state.readings[1];
  assert.equal(result.officialReadingId, 'winner-reading');
  assert.equal(winner.type, 'CLUBVISION');
  assert.equal(winner.id, winnerBefore.id);
  assert.deepEqual(winner.conversations, winnerBefore.conversations);
  assert.equal(state.readings.filter(({ type }) => type === 'CLUBVISION').length, 1);
});

test('sin lectura configurada no crea una copia para la ganadora', async () => {
  const { state, tx } = fakeTransaction();
  state.readings.splice(1, 1);
  const result = await transitionClubvisionToReading(tx as never, {
    clubvisionId: 'cv', clubId: 'club', edition: '2026-08', winnerBookId: 'winner-book',
  });
  assert.equal(result.officialReadingId, null);
  assert.equal(state.readings.length, 1);
  assert.equal(state.readings[0]?.type, 'FREE');
});

test('sincronizar dos veces no cambia más datos', async () => {
  const { state, tx } = fakeTransaction();
  const first = await transitionClubvisionToReading(tx as never, {
    clubvisionId: 'cv', clubId: 'club', edition: '2026-08', winnerBookId: 'winner-book',
  });
  const snapshot = structuredClone(state);
  const second = await transitionClubvisionToReading(tx as never, {
    clubvisionId: 'cv', clubId: 'club', edition: '2026-08', winnerBookId: 'winner-book',
  });
  assert.equal(first.transitioned, true);
  assert.equal(second.transitioned, false);
  assert.deepEqual(state, snapshot);
});

test('la notificación depende exclusivamente de una transición real', async () => {
  const service = await readFile(new URL('../src/services/clubvision.service.ts', import.meta.url), 'utf8');
  assert.match(service, /transition\.transitioned &&[\s\S]*notifyLecturaNueva/);
  assert.match(service, /current\?\.status !== 'RESULTADOS'/);
  assert.match(service, /clubvision:reading:\$\{params\.clubId\}:\$\{params\.edition\}/);
});

test('la configuración manual promociona o crea una sola oficial bajo bloqueo', async () => {
  const service = await readFile(new URL('../src/services/readings.service.ts', import.meta.url), 'utf8');
  assert.match(service, /reading:official:\$\{club\.id\}/);
  assert.match(service, /type: ReadingType\.CLUBVISION,[\s\S]*id: \{ not: existing\.id \}/);
  assert.match(service, /existing\.type !== ReadingType\.CLUBVISION[\s\S]*data: \{ type: ReadingType\.CLUBVISION \}/);
  assert.match(service, /if \(existing\)[\s\S]*return \{ alreadyExists: false, created: false \}/);
});
