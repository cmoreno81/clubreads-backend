import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertDisposableDatabaseWritesAllowed,
  inspectDisposableDatabaseUrl,
} from '../scripts/disposable-db-safety.js';

test('acepta únicamente el destino local desechable exacto', () => {
  const target = inspectDisposableDatabaseUrl(
    'postgresql://test:local@127.0.0.1:55432/clubreads_disposable_test',
  );
  assert.deepEqual(target, {
    host: '127.0.0.1',
    port: '55432',
    database: 'clubreads_disposable_test',
    locality: 'local',
  });
});

test('falla cerrada ante URL inválida, Railway, host remoto, base o puerto incorrectos', () => {
  const rejected = [
    'no-es-una-url',
    'postgresql://test:local@containers.railway.app:55432/clubreads_disposable_test',
    'postgresql://test:local@192.168.1.10:55432/clubreads_disposable_test',
    'postgresql://test:local@127.0.0.1:55432/clubreads',
    'postgresql://test:local@127.0.0.1:5432/clubreads_disposable_test',
    'mysql://test:local@127.0.0.1:55432/clubreads_disposable_test',
  ];
  for (const url of rejected) {
    assert.throws(() => inspectDisposableDatabaseUrl(url));
  }
});

test('toda escritura exige confirmación adicional exacta', () => {
  const previous = process.env.ALLOW_DISPOSABLE_DB_WRITES;
  const url = 'postgresql://test:local@localhost:55432/clubreads_disposable_test';
  try {
    process.env.ALLOW_DISPOSABLE_DB_WRITES = 'false';
    assert.throws(() => assertDisposableDatabaseWritesAllowed(url));
    process.env.ALLOW_DISPOSABLE_DB_WRITES = 'true';
    assert.equal(assertDisposableDatabaseWritesAllowed(url).database, 'clubreads_disposable_test');
  } finally {
    if (previous === undefined) delete process.env.ALLOW_DISPOSABLE_DB_WRITES;
    else process.env.ALLOW_DISPOSABLE_DB_WRITES = previous;
  }
});
