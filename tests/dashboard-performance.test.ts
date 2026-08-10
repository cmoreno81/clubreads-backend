import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { getDashboard, madridMonthRange } from '../src/services/dashboard.service.js';

function fixture() {
  const calls: Array<{ model: string; operation: string; args: any }> = [];
  const record = <T>(model: string, operation: string, value: T) => async (args: any) => {
    calls.push({ model, operation, args });
    return value;
  };
  const client = {
    readingCompletion: {
      groupBy: record('readingCompletion', 'groupBy', [
        { userId: 'u1', _count: { id: 3 } },
        { userId: 'u2', _count: { id: 3 } },
        { userId: 'u3', _count: { id: 1 } },
        // Volumen representativo: el servicio recibe un grupo, no 10.000 filas.
        { userId: 'u4', _count: { id: 10_000 } },
      ]),
      findMany: record('readingCompletion', 'findMany', []),
    },
    review: {
      aggregate: record('review', 'aggregate', { _avg: { rating: 4.25 } }),
      findMany: record('review', 'findMany', [{ userId: 'u1', rating: 4.5 }]),
    },
    library: {
      findMany: async (args: any) => {
        calls.push({ model: 'library', operation: 'findMany', args });
        if (args.where.status === 'FINISHED') {
          return [{ userId: 'u1', user: { name: 'Ana' } }];
        }
        return [{
          id: 'library-1', lastProgress: 40, currentPage: 120,
          progressNote: 'nota local', progressUpdatedAt: null,
          user: { name: 'Ana', avatarUrl: '/ana.jpg' },
          book: {
            id: 'winner', title: 'Libro ganador', coverUrl: '/cover.jpg',
            totalPages: 300, genre: { name: 'Romance' },
          },
          progressReactions: [{ userId: 'current', reaction: 'LIKE' }],
        }];
      },
    },
    user: {
      findMany: record('user', 'findMany', [
        { id: 'u1', name: 'Ana', avatarUrl: '/ana.jpg' },
        { id: 'u2', name: 'Bea', avatarUrl: null },
        { id: 'u3', name: 'Carla', avatarUrl: '/carla.jpg' },
        { id: 'u4', name: 'Diana', avatarUrl: '/diana.jpg' },
      ]),
    },
    reading: { findFirst: record('reading', 'findFirst', { id: 'reading-1' }) },
    comment: {
      count: record('comment', 'count', 2),
      findFirst: record('comment', 'findFirst', {
        createdAt: new Date('2026-08-09T10:00:00Z'), parentId: 'root',
        user: { name: 'Bea' },
      }),
    },
    like: { count: record('like', 'count', 3) },
    clubMember: { findMany: record('clubMember', 'findMany', []) },
  } as any;
  return { client, calls };
}

test('filtra el mes de Madrid en PostgreSQL y agrega sin cargar finalizaciones', async () => {
  const { client, calls } = fixture();
  const result = await getDashboard('Actual', {
    client,
    getContext: async () => ({
      club: { id: 'club', name: 'Club' },
      user: { id: 'current', name: 'Actual', avatarUrl: '/actual.jpg' },
    } as any),
    clubvisionSnapshot: async () => ({
      ganador: 'Libro ganador', ganadorBookId: 'winner', ganadorCoverUrl: '/cover.jpg',
      mensaje: '', totalCandidatas: 5,
    } as any),
    affinity: async () => [{ id: 'u1', nombre: 'Ana', avatarUrl: '/ana.jpg', librosComunes: 2 }],
  });

  const monthly = calls.find(({ model, operation }) => model === 'readingCompletion' && operation === 'groupBy');
  assert.deepEqual(monthly?.args.by, ['userId']);
  assert.ok(monthly?.args.where.finishedAt.gte instanceof Date);
  assert.ok(monthly?.args.where.finishedAt.lt instanceof Date);
  assert.equal(calls.some(({ model, operation }) => model === 'readingCompletion' && operation === 'findMany'), false);
  assert.equal(result.resumen.actividadMes, 10_007);
  assert.deepEqual(result.topLectorasMes.map(({ nombre, total }) => [nombre, total]), [
    ['Diana', 10_000], ['Ana', 3], ['Bea', 3],
  ]);
  assert.equal(result.resumen.usuarioMes, 'Diana');
  assert.equal(result.resumen.valoracionMedia, '4.25');
});

test('mantiene contadores, valoración y texto funcional sin cargar el árbol', async () => {
  const { client, calls } = fixture();
  const result = await getDashboard('Actual', {
    client,
    getContext: async () => ({
      club: { id: 'club', name: 'Club' },
      user: { id: 'current', name: 'Actual', avatarUrl: null },
    } as any),
    clubvisionSnapshot: async () => ({
      ganador: 'Libro ganador', ganadorBookId: 'winner', ganadorCoverUrl: '/cover.jpg',
      mensaje: '', totalCandidatas: 1,
    } as any),
    affinity: async () => [],
  });
  assert.equal(result.lecturaActual.comentarios, 2);
  assert.equal(result.lecturaActual.likes, 3);
  assert.equal(result.lecturaActual.ultimaActividad, '2026-08-09T10:00:00.000Z');
  assert.deepEqual(result.lecturaActual.finalizado, [{ usuario: 'Ana', valoracion: '⭐⭐⭐⭐½' }]);
  assert.equal(result.lecturaActual.coverUrl, '/cover.jpg');

  assert.equal(calls.length, 10);
  for (const call of calls) assert.equal('include' in (call.args ?? {}), false, `${call.model}.${call.operation}`);
  const officialReading = calls.find(({ model }) => model === 'reading');
  assert.deepEqual(officialReading?.args.select, { id: true });
  const latest = calls.find(({ model, operation }) => model === 'comment' && operation === 'findFirst');
  assert.deepEqual(latest?.args.orderBy, [{ createdAt: 'desc' }, { id: 'desc' }]);
  assert.deepEqual(latest?.args.select, { createdAt: true });
});

test('los límites mensuales respetan el cambio horario de Europe/Madrid', () => {
  assert.deepEqual(madridMonthRange(new Date('2026-08-09T12:00:00Z')), {
    start: new Date('2026-07-31T22:00:00Z'),
    end: new Date('2026-08-31T22:00:00Z'),
  });
  assert.deepEqual(madridMonthRange(new Date('2026-01-09T12:00:00Z')), {
    start: new Date('2025-12-31T23:00:00Z'),
    end: new Date('2026-01-31T23:00:00Z'),
  });
});

test('dashboard usa snapshot Clubvisión y no sincroniza en cada apertura', async () => {
  const [dashboard, clubvision] = await Promise.all([
    readFile(new URL('../src/services/dashboard.service.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/services/clubvision.service.ts', import.meta.url), 'utf8'),
  ]);
  const getDashboardSource = dashboard.slice(
    dashboard.indexOf('export async function getDashboard'),
    dashboard.indexOf('// ─────────────────────────────────────────────\n// Detalle de afinidad'),
  );
  assert.match(getDashboardSource, /clubvisionSnapshot\(usuario, context\)/);
  assert.doesNotMatch(getDashboardSource, /synchronizeCurrentClubvision|getClubvision\(/);
  assert.match(clubvision, /getClubvisionSnapshot[\s\S]*synchronize: false/);
});
