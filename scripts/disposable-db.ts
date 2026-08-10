import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { resolve, sep } from 'node:path';
import pg from 'pg';

import {
  assertDisposableDatabaseWritesAllowed,
  inspectDisposableDatabaseUrl,
  printDisposableTarget,
} from './disposable-db-safety.js';
import { postgresEnvironment, runSafe } from './postgres-backup-common.js';

const command = process.argv[2];
const backupPath = process.argv[3];
const PG_RESTORE = '/opt/homebrew/opt/postgresql@18/bin/pg_restore';

function outsideRepository(candidate: string) {
  const repository = resolve(process.cwd());
  const target = resolve(candidate);
  if (target === repository || target.startsWith(`${repository}${sep}`)) {
    throw new Error('El backup debe permanecer fuera del repositorio');
  }
  return target;
}

async function withClient<T>(callback: (client: pg.Client) => Promise<T>) {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try { return await callback(client); } finally { await client.end(); }
}

async function assertEmpty() {
  const result = await withClient((client) => client.query<{ count: string }>(`
    SELECT count(*)::text AS count FROM pg_tables
    WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
  `));
  if (Number(result.rows[0]?.count ?? -1) !== 0) {
    throw new Error('La base no está vacía; restauración cancelada (nunca se usa --clean)');
  }
}

async function verify() {
  const result = await withClient(async (client) => {
    const counts = await client.query(`
      SELECT
        (SELECT count(*)::bigint FROM "User") AS users,
        (SELECT count(*)::bigint FROM "Club") AS clubs,
        (SELECT count(*)::bigint FROM "Book") AS books,
        (SELECT count(*)::bigint FROM "Library") AS libraries,
        (SELECT count(*)::bigint FROM "Reading") AS readings,
        (SELECT count(*)::bigint FROM "Comment") AS comments,
        (SELECT count(*)::bigint FROM "AuthSession") AS sessions
    `);
    const integrity = await client.query(`
      SELECT
        (SELECT count(*)::bigint FROM pg_constraint WHERE contype='f' AND NOT convalidated) AS unvalidated_foreign_keys,
        (SELECT count(*)::bigint FROM "Library" l LEFT JOIN "User" u ON u.id=l."userId" LEFT JOIN "Book" b ON b.id=l."bookId" WHERE u.id IS NULL OR b.id IS NULL) AS orphan_libraries,
        (SELECT count(*)::bigint FROM "Reading" r LEFT JOIN "Club" c ON c.id=r."clubId" LEFT JOIN "Book" b ON b.id=r."bookId" WHERE c.id IS NULL OR b.id IS NULL) AS orphan_readings,
        (SELECT count(*)::bigint FROM "Comment" c LEFT JOIN "Conversation" v ON v.id=c."conversationId" LEFT JOIN "User" u ON u.id=c."userId" WHERE v.id IS NULL OR u.id IS NULL) AS orphan_comments,
        (SELECT count(*)::bigint FROM "AuthSession" s LEFT JOIN "User" u ON u.id=s."userId" WHERE u.id IS NULL) AS orphan_sessions,
        (SELECT count(*)::bigint FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL) AS applied_migrations,
        (SELECT count(*)::bigint FROM "_prisma_migrations" WHERE finished_at IS NULL AND rolled_back_at IS NULL) AS incomplete_migrations
    `);
    return { counts: counts.rows[0], integrity: integrity.rows[0] };
  });
  console.log(JSON.stringify(result, null, 2));
}

async function runInherited(executable: string, args: string[]) {
  await new Promise<void>((resolveRun, reject) => {
    const child = spawn(executable, args, { env: process.env, stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (code) => code === 0 ? resolveRun() : reject(new Error(`${executable} terminó con código ${code}`)));
  });
}

switch (command) {
  case 'health': {
    const target = inspectDisposableDatabaseUrl();
    printDisposableTarget(target);
    await withClient((client) => client.query('SELECT 1'));
    console.log('Health: OK');
    break;
  }
  case 'restore': {
    const target = assertDisposableDatabaseWritesAllowed();
    printDisposableTarget(target);
    if (process.env.CONFIRM_DISPOSABLE_RESTORE !== 'RESTORE_TO_VERIFIED_DISPOSABLE_DB') {
      throw new Error('Falta autorización: CONFIRM_DISPOSABLE_RESTORE=RESTORE_TO_VERIFIED_DISPOSABLE_DB');
    }
    if (!backupPath) throw new Error('Indica la ruta de un backup custom fuera del repositorio');
    const safeBackup = outsideRepository(backupPath);
    await assertEmpty();
    await runSafe(PG_RESTORE, ['--list', safeBackup]);
    await runSafe(PG_RESTORE, [
      '--exit-on-error', '--single-transaction', '--no-owner', '--no-acl',
      `--dbname=${target.database}`, safeBackup,
    ], postgresEnvironment(process.env.DATABASE_URL!));
    await verify();
    break;
  }
  case 'verify':
    inspectDisposableDatabaseUrl();
    await verify();
    break;
  case 'migrate-status':
    inspectDisposableDatabaseUrl();
    await runInherited('npx', ['prisma', 'migrate', 'status']);
    break;
  case 'backend':
    assertDisposableDatabaseWritesAllowed();
    if (!['capture', 'disabled'].includes(process.env.AUTH_EMAIL_MODE ?? '') || process.env.CLOUDINARY_WRITES_ENABLED !== 'false' || process.env.COVER_BACKFILL_ENABLED !== 'false' || process.env.CRON_ENABLED !== 'false' || process.env.EXTERNAL_NOTIFICATIONS_ENABLED !== 'false') {
      throw new Error('La configuración desechable no bloquea todos los efectos externos');
    }
    process.env.AUTH_ACCESS_TOKEN_SECRET ??= createHash('sha256')
      .update(`disposable:${process.env.DATABASE_URL}`)
      .digest('base64url');
    process.env.PORT ??= '3101';
    await runInherited('npm', ['run', 'dev']);
    break;
  case 'write-command': {
    assertDisposableDatabaseWritesAllowed();
    const executable = process.argv[3];
    const args = process.argv.slice(4);
    if (!executable) throw new Error('Falta el comando de escritura');
    await runInherited(executable, args);
    break;
  }
  default:
    throw new Error('Comando: health | restore RUTA | verify | migrate-status | backend | write-command ...');
}
