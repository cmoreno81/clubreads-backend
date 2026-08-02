import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

const dumpPath = process.argv[2];
if (!dumpPath) throw new Error('Indica la ruta del dump');

const postgresBin = '/opt/homebrew/opt/postgresql@18/bin';
const root = await mkdtemp(join(tmpdir(), 'clubreads-migration-check-'));
const dataDir = join(root, 'data');
const port = '55439';
const databaseUrl = `postgresql://127.0.0.1:${port}/clubreads_check`;

function run(command: string, args: string[], options: { input?: string } = {}) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '';
    let errorOutput = '';
    child.stdout.on('data', (value) => output += String(value));
    child.stderr.on('data', (value) => errorOutput += String(value));
    child.once('error', reject);
    child.once('exit', (code) => code === 0
      ? resolve(output)
      : reject(new Error(`${command} terminó con ${code}: ${errorOutput}`)));
    child.stdin.end(options.input);
  });
}

let started = false;
try {
  await run(`${postgresBin}/initdb`, ['--pgdata', dataDir, '--auth=trust', '--no-locale']);
  await run(`${postgresBin}/pg_ctl`, ['--pgdata', dataDir, '--options', `-p ${port} -h 127.0.0.1`, '--wait', 'start']);
  started = true;
  await run(`${postgresBin}/createdb`, ['--host=127.0.0.1', `--port=${port}`, 'clubreads_check']);
  await run(`${postgresBin}/pg_restore`, ['--no-owner', '--no-acl', `--dbname=${databaseUrl}`, dumpPath]);
  const migration = await readFile(
    new URL('../prisma/migrations/20260802190000_canonical_book_identity/migration.sql', import.meta.url),
    'utf8',
  );
  await run(`${postgresBin}/psql`, [`--dbname=${databaseUrl}`, '--set=ON_ERROR_STOP=1'], { input: migration });
  const verification = await run(`${postgresBin}/psql`, [
    `--dbname=${databaseUrl}`,
    '--tuples-only',
    '--no-align',
    '--command',
    `SELECT json_build_object(
      'activeBooks', (SELECT count(*) FROM "Book" WHERE "deletedAt" IS NULL),
      'missingCanonicalKeys', (SELECT count(*) FROM "Book" WHERE "canonicalKey" IS NULL),
      'redirectTable', to_regclass('public."BookRedirect"') IS NOT NULL,
      'auditTable', to_regclass('public."BookMergeAudit"') IS NOT NULL,
      'canonicalIndex', to_regclass('public."Book_active_canonicalKey_key"') IS NOT NULL,
      'isbnIndex', to_regclass('public."Book_active_normalizedIsbn_key"') IS NOT NULL
    );`,
  ]);
  console.log(JSON.stringify({ ok: true, temporaryCluster: root, verification: JSON.parse(verification.trim()) }));
} finally {
  if (started) {
    await run(`${postgresBin}/pg_ctl`, ['--pgdata', dataDir, '--mode=fast', '--wait', 'stop']);
  }
}
