import { chmod, mkdtemp, unlink, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import pg from 'pg';

import {
  assertOutsideRepository,
  assertSafeRestoreTarget,
  postgresEnvironment,
  runSafe,
} from './postgres-backup-common.js';

const encryptedPath = process.argv[2];
const targetUrl = process.env.RESTORE_DATABASE_URL;
const identityFile = process.env.BACKUP_AGE_IDENTITY_FILE;
if (!encryptedPath) throw new Error('Indica el archivo .dump.age');
if (!targetUrl) throw new Error('RESTORE_DATABASE_URL no está definida');
if (!identityFile) throw new Error('BACKUP_AGE_IDENTITY_FILE no está definida');
if (process.env.RESTORE_CONFIRM_EMPTY_TEST_DATABASE !== 'YES') {
  throw new Error('Confirma el destino vacío con RESTORE_CONFIRM_EMPTY_TEST_DATABASE=YES');
}
assertOutsideRepository(encryptedPath);
assertSafeRestoreTarget(targetUrl);

const client = new pg.Client({ connectionString: targetUrl });
await client.connect();
const before = await client.query<{ tables: string }>(`
  SELECT count(*)::text AS tables
  FROM pg_tables
  WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
`);
await client.end();
if (Number(before.rows[0]?.tables ?? -1) !== 0) {
  throw new Error('La base temporal no está vacía; restauración cancelada');
}

process.umask(0o077);
const root = await mkdtemp(join(tmpdir(), 'clubreads-restore-'));
await chmod(root, 0o700);
const temporaryDump = join(root, 'restore.dump');
const restoreStartedAt = performance.now();
try {
  await runSafe('age', [
    '--decrypt', '--identity', identityFile,
    '--output', temporaryDump, encryptedPath,
  ]);
  await chmod(temporaryDump, 0o600);
  await runSafe('pg_restore', ['--list', temporaryDump]);
  const restoreEnvironment = postgresEnvironment(targetUrl);
  await runSafe('pg_restore', [
    '--exit-on-error', '--single-transaction', '--no-owner', '--no-acl',
    `--dbname=${restoreEnvironment.PGDATABASE}`,
    temporaryDump,
  ], restoreEnvironment);

  const validation = new pg.Client({ connectionString: targetUrl });
  await validation.connect();
  const counts = await validation.query<Record<string, string>>(`
    SELECT
      (SELECT count(*)::text FROM "User") AS users,
      (SELECT count(*)::text FROM "Club") AS clubs,
      (SELECT count(*)::text FROM "Book") AS books,
      (SELECT count(*)::text FROM "Library") AS libraries,
      (SELECT count(*)::text FROM "Reading") AS readings,
      (SELECT count(*)::text FROM "Comment") AS comments,
      (SELECT count(*)::text FROM "AuthSession") AS sessions
  `);
  const integrity = await validation.query<Record<string, string>>(`
    SELECT
      (SELECT count(*)::text FROM pg_constraint WHERE contype = 'f' AND NOT convalidated) AS invalid_foreign_keys,
      (SELECT count(*)::text FROM "Library" l LEFT JOIN "User" u ON u.id=l."userId" LEFT JOIN "Book" b ON b.id=l."bookId" WHERE u.id IS NULL OR b.id IS NULL) AS orphan_libraries,
      (SELECT count(*)::text FROM "Reading" r LEFT JOIN "Club" c ON c.id=r."clubId" LEFT JOIN "Book" b ON b.id=r."bookId" WHERE c.id IS NULL OR b.id IS NULL) AS orphan_readings,
      (SELECT count(*)::text FROM "Comment" c LEFT JOIN "Conversation" v ON v.id=c."conversationId" LEFT JOIN "User" u ON u.id=c."userId" WHERE v.id IS NULL OR u.id IS NULL) AS orphan_comments,
      (SELECT count(*)::text FROM "AuthSession" s LEFT JOIN "User" u ON u.id=s."userId" WHERE u.id IS NULL) AS orphan_sessions,
      (SELECT count(*)::text FROM "_prisma_migrations" WHERE "finished_at" IS NOT NULL AND "rolled_back_at" IS NULL) AS applied_migrations,
      (SELECT count(*)::text FROM "_prisma_migrations" WHERE "finished_at" IS NULL AND "rolled_back_at" IS NULL) AS failed_migrations
  `);
  await validation.end();

  console.log(JSON.stringify({
    ok: true,
    restoreDurationMs: Math.round(performance.now() - restoreStartedAt),
    counts: counts.rows[0],
    integrity: integrity.rows[0],
  }));
} finally {
  await unlink(temporaryDump).catch(() => undefined);
  await rmdir(root).catch(() => undefined);
}
