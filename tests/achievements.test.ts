import assert from 'node:assert/strict';
import test from 'node:test';

import { buildAchievementDefinitions, buildAchievementState } from '../src/services/achievements.service.js';

test('las definiciones vigentes tienen estructura completa e IDs únicos', () => {
  const definitions = buildAchievementDefinitions();
  assert.ok(definitions.length > 5);
  assert.equal(new Set(definitions.map(({ id }) => id)).size, definitions.length);
  assert.equal(new Set(definitions.map(({ key }) => key)).size, definitions.length);
  for (const definition of definitions) {
    assert.ok(definition.id.trim());
    assert.ok(definition.key.trim());
    assert.ok(definition.title.trim());
    assert.ok(definition.description.trim());
    assert.ok(definition.icon.trim());
    assert.ok(definition.category.trim());
    assert.ok(Number.isSafeInteger(definition.target) && definition.target > 0);
    assert.ok(['common', 'rare', 'epic', 'legendary'].includes(definition.rarity));
  }
});

test('calcula progreso con el catálogo vigente sin depender de posiciones', () => {
  const results = buildAchievementState(buildAchievementDefinitions(), {
    completedBooks: [
      { bookId: 'b1', finishedAt: new Date('2024-01-01T00:00:00.000Z'), genreName: 'Romance', pages: 600 },
      { bookId: 'b2', finishedAt: new Date('2024-01-02T00:00:00.000Z'), genreName: 'Fantasy', pages: 500 },
    ],
    completedSeries: [{ id: 's1', completedAt: new Date('2024-01-04T00:00:00.000Z') }],
    reviews: [{ createdAt: new Date('2024-01-05T00:00:00.000Z') }],
    genreCounts: new Map([['romance', 1], ['fantasy', 1]]),
    totalPages: 1_100,
  });
  const byKey = new Map(results.map((result) => [result.key, result]));
  assert.equal(byKey.get('primer-libro')?.progress, 2);
  assert.equal(byKey.get('primer-libro')?.unlocked, true);
  assert.equal(byKey.get('diez-libros')?.unlocked, false);
  assert.equal(byKey.get('primera-saga')?.unlocked, true);
  assert.equal(byKey.get('mil-paginas')?.unlocked, true);
  assert.equal(byKey.get('primera-resena')?.unlockedAt?.toISOString(), '2024-01-05T00:00:00.000Z');
});

test('métricas ausentes y valores cero se interpretan defensivamente como cero', () => {
  const definitions = buildAchievementDefinitions();
  for (const data of [{}, {
    completedBooks: [], completedSeries: [], reviews: [], comments: 0,
    clubvisionVotes: 0, totalPages: 0, genreCounts: new Map(),
    booksThisMonth: 0, booksThisYear: 0, abandonedBooks: 0,
  }]) {
    const results = buildAchievementState(definitions, data);
    assert.equal(results.length, definitions.length);
    assert.ok(results.every(({ progress, unlocked, unlockedAt }) =>
      progress === 0 && unlocked === false && unlockedAt === null));
  }
});
