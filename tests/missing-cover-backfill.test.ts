import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  backfillMissingBookCovers,
  runMissingCoverBackfillJob,
} from '../src/services/missing-cover-backfill.service.js';
import { main } from '../src/jobs/missing-cover-backfill.job.js';

test('el servidor web no importa ni inicia el backfill', () => {
  const server = readFileSync('src/server.ts', 'utf8');
  assert.doesNotMatch(server, /MissingCoverBackfill|backfillMissingBookCovers/);
  assert.match(server, /app\.listen/);
});

test('el advisory lock permite un solo job simultáneo y se libera', async () => {
  let locked = false;
  let releaseFirst!: () => void;
  const firstCanFinish = new Promise<void>((resolve) => { releaseFirst = resolve; });
  function createLockClient() {
    return {
      async connect() {},
      async query<T>(text: string) {
        if (text.includes('pg_try_advisory_lock')) {
          const acquired = !locked;
          if (acquired) locked = true;
          return { rows: [{ acquired }] as T[] };
        }
        if (text.includes('pg_advisory_unlock')) locked = false;
        return { rows: [] as T[] };
      },
      async end() {},
    };
  }
  const executeBackfill = async () => {
    await firstCanFinish;
    return {
      skipped: false, checked: 0, found: 0, applied: 0, matches: [],
      examined: 0, added: 0, omitted: 0, failures: 0, durationMs: 1,
    };
  };

  const first = runMissingCoverBackfillJob({}, { createLockClient, executeBackfill });
  await new Promise((resolve) => setImmediate(resolve));
  const second = await runMissingCoverBackfillJob({}, { createLockClient, executeBackfill });
  assert.equal(second.skipped, true);
  assert.equal(second.reason, 'LOCKED');
  releaseFirst();
  assert.equal((await first).skipped, false);
  assert.equal(locked, false);
});

test('no sobrescribe portadas y un error individual no aborta el lote', async () => {
  const updates: any[] = [];
  const books = [
    { id: 'a', title: 'Uno', isbn: null, author: { name: 'Autora' } },
    { id: 'b', title: 'Dos', isbn: null, author: { name: 'Autora' } },
    { id: 'c', title: 'Tres', isbn: null, author: { name: 'Autora' } },
  ];
  const database = {
    book: {
      async findMany(args: any) {
        assert.deepEqual(args.where.OR, [{ coverUrl: null }, { coverUrl: '' }]);
        return books;
      },
      async updateMany(args: any) {
        updates.push(args);
        return { count: 1 };
      },
    },
  } as any;
  const result = await backfillMissingBookCovers(
    { apply: true, limit: 3 },
    {
      database,
      findCover: async ({ title }) => {
        if (title === 'Dos') throw new Error('respuesta externa privada');
        return title === 'Uno' ? 'https://covers.example/one.jpg' : null;
      },
      pause: async () => {},
    },
  );
  assert.equal(result.examined, 3);
  assert.equal(result.added, 1);
  assert.equal(result.omitted, 1);
  assert.equal(result.failures, 1);
  assert.equal(updates.length, 1);
  assert.deepEqual(updates[0].where.OR, [{ coverUrl: null }, { coverUrl: '' }]);
});

test('el comando emite resumen, código correcto y siempre desconecta Prisma', async () => {
  let disconnected = 0;
  const output: string[] = [];
  const code = await main(['--limit', '25'], {
    run: async ({ limit }) => {
      assert.equal(limit, 25);
      return { skipped: false, examined: 4, added: 1, omitted: 2, failures: 1, durationMs: 50 };
    },
    disconnect: async () => { disconnected++; },
    output: (value) => output.push(value),
  });
  assert.equal(code, 0);
  assert.equal(disconnected, 1);
  assert.deepEqual(JSON.parse(output[0]!), {
    skipped: false, examined: 4, added: 1, omitted: 2, failures: 1, durationMs: 50,
  });

  const failureCode = await main([], {
    run: async () => { throw new Error('postgresql://user:password@private/db'); },
    disconnect: async () => { disconnected++; },
    errorOutput: (value) => output.push(value),
  });
  assert.equal(failureCode, 1);
  assert.equal(disconnected, 2);
  assert.doesNotMatch(output.at(-1)!, /password|postgresql|private/);
});

test('conserva límites, validación de identidad y timeouts externos', () => {
  const service = readFileSync('src/services/missing-cover-backfill.service.ts', 'utf8');
  const coverService = readFileSync('src/services/book-cover.service.ts', 'utf8');
  const packageJson = readFileSync('package.json', 'utf8');
  assert.match(service, /DEFAULT_BATCH_SIZE = 200/);
  assert.match(service, /MAX_BATCH_SIZE = 500/);
  assert.match(service, /pg_try_advisory_lock/);
  assert.match(service, /findImportedBookCover/);
  assert.match(coverService, /sameAuthor\(identity\.author/);
  assert.match(coverService, /maxResults', '20'/);
  assert.match(coverService, /AbortSignal\.timeout\(8_000\)/);
  assert.match(packageJson, /"covers:scheduled": "node dist\/jobs\/missing-cover-backfill\.job\.js"/);
});
