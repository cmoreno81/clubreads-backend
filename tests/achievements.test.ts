import assert from 'node:assert/strict';
import test from 'node:test';

import { buildAchievementDefinitions, buildAchievementState } from '../src/services/achievements.service.js';

test('define los logros iniciales con los campos esperados', () => {
  const definitions = buildAchievementDefinitions();

  assert.equal(definitions.length, 5);
  assert.deepEqual(definitions.map((achievement) => achievement.key), [
    'primer-libro',
    'diez-libros',
    'maestra-de-sagas',
    'romance-addict',
    'primera-resena',
  ]);
  assert.equal(definitions[0].title, 'Primer libro');
  assert.equal(definitions[4].category, 'reviews');
});

test('calcula progreso y desbloqueo a partir de datos existentes', () => {
  const definitions = buildAchievementDefinitions();
  const data = {
    completedBooks: [
      { id: 'b1', finishedAt: new Date('2024-01-01T00:00:00.000Z'), genreName: 'Romance' },
      { id: 'b2', finishedAt: new Date('2024-01-02T00:00:00.000Z'), genreName: 'Fantasy' },
      { id: 'b3', finishedAt: new Date('2024-01-03T00:00:00.000Z'), genreName: 'Romance' },
      { id: 'b4', finishedAt: new Date('2024-01-04T00:00:00.000Z'), genreName: 'Romance' },
    ],
    completedSeries: [
      { id: 's1', completedAt: new Date('2024-01-04T00:00:00.000Z') },
    ],
    reviews: [{ createdAt: new Date('2024-01-05T00:00:00.000Z') }],
  };

  const results = buildAchievementState(definitions, data);

  assert.equal(results[0].progress, 4);
  assert.equal(results[0].unlocked, true);
  assert.equal(results[1].progress, 4);
  assert.equal(results[1].unlocked, false);
  assert.equal(results[2].progress, 1);
  assert.equal(results[2].unlocked, true);
  assert.equal(results[3].progress, 3);
  assert.equal(results[3].unlocked, true);
  assert.equal(results[4].progress, 1);
  assert.equal(results[4].unlocked, true);
  assert.equal(results[4].unlockedAt?.toISOString(), '2024-01-05T00:00:00.000Z');
});
