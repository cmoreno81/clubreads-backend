import assert from 'node:assert/strict';
import test from 'node:test';

import {
  equivalentCompletionKey,
  mostCompleteCompletion,
} from '../src/services/book-merge.service.js';

function completion(overrides: Record<string, unknown> = {}) {
  return {
    id: 'completion',
    userId: 'user',
    bookId: 'book',
    startedAt: null,
    finishedAt: new Date('2026-01-10T12:00:00Z'),
    isReread: false,
    rating: null,
    review: null,
    readingFormat: null,
    createdAt: new Date('2026-01-11T12:00:00Z'),
    updatedAt: new Date('2026-01-11T12:00:00Z'),
    ...overrides,
  } as never;
}

test('solo considera equivalentes misma usuaria, fecha e indicador de relectura', () => {
  const original = completion();
  assert.equal(equivalentCompletionKey(original), equivalentCompletionKey(completion({ id: 'copy' })));
  assert.equal(
    equivalentCompletionKey(original),
    equivalentCompletionKey(completion({ finishedAt: new Date('2026-01-10T23:30:00Z') })),
  );
  assert.notEqual(
    equivalentCompletionKey(original),
    equivalentCompletionKey(completion({ finishedAt: new Date('2026-02-10T12:00:00Z') })),
  );
  assert.notEqual(
    equivalentCompletionKey(original),
    equivalentCompletionKey(completion({ isReread: true })),
  );
  assert.notEqual(
    equivalentCompletionKey(original),
    equivalentCompletionKey(completion({ userId: 'other-user' })),
  );
});

test('conserva la finalización con más información aunque esté en la copia origen', () => {
  const sparse = completion({ id: 'canonical', bookId: 'canonical' });
  const complete = completion({
    id: 'source',
    bookId: 'source',
    startedAt: new Date('2026-01-01T12:00:00Z'),
    rating: 4,
    review: 'Texto conservado',
    readingFormat: 'DIGITAL',
  });
  assert.equal(mostCompleteCompletion([sparse, complete]).id, 'source');
});

test('en empate conserva la entrada actualizada más recientemente', () => {
  const original = completion({ id: 'original', createdAt: new Date('2026-01-01T12:00:00Z'), rating: 5 });
  const imported = completion({
    id: 'imported',
    createdAt: new Date('2026-08-02T12:00:00Z'),
    updatedAt: new Date('2026-08-02T12:00:00Z'),
    rating: 4,
  });
  assert.equal(mostCompleteCompletion([imported, original]).id, 'imported');
});
