import { spawn } from 'node:child_process';
import { chmod, mkdir, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';

const PG_BIN = '/opt/homebrew/opt/postgresql@18/bin';
const BACKUP_DIRECTORY = '/Users/cristinamoreno/Backups/ClubReads';
const rawUrl = process.env.DATABASE_PUBLIC_URL;

if (!rawUrl) throw new Error('DATABASE_PUBLIC_URL no está definida');

let url: URL;
try {
  url = new URL(rawUrl);
} catch {
  throw new Error('DATABASE_PUBLIC_URL no se puede interpretar');
}

if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
  throw new Error('DATABASE_PUBLIC_URL no usa PostgreSQL');
}
if (!url.hostname || !url.username || !url.password || !url.pathname.slice(1)) {
  throw new Error('DATABASE_PUBLIC_URL está incompleta');
}

const timestamp = new Date().toISOString()
  .replace(/[-:]/g, '')
  .replace(/\.\d{3}Z$/, 'Z');
const backupPath = join(BACKUP_DIRECTORY, `clubreads-${timestamp}.dump`);
const { DATABASE_PUBLIC_URL: _publicUrl, DATABASE_URL: _databaseUrl, ...safeBase } = process.env;
const pgEnvironment: NodeJS.ProcessEnv = {
  ...safeBase,
  PGHOST: url.hostname,
  PGPORT: url.port || '5432',
  PGDATABASE: decodeURIComponent(url.pathname.slice(1)),
  PGUSER: decodeURIComponent(url.username),
  PGPASSWORD: decodeURIComponent(url.password),
  PGCONNECT_TIMEOUT: '15',
};
const sslMode = url.searchParams.get('sslmode');
if (sslMode) pgEnvironment.PGSSLMODE = sslMode;

function run(command: string, args: string[], environment = process.env) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      env: environment,
      stdio: ['ignore', 'ignore', 'ignore'],
    });
    child.once('error', () => reject(new Error('No se pudo iniciar una herramienta PostgreSQL')));
    child.once('exit', (code) => code === 0
      ? resolve()
      : reject(new Error('La herramienta PostgreSQL terminó con error')));
  });
}

process.umask(0o077);
await mkdir(BACKUP_DIRECTORY, { recursive: true, mode: 0o700 });
await chmod(BACKUP_DIRECTORY, 0o700);

try {
  await run(`${PG_BIN}/pg_dump`, [
    '--format=custom',
    '--no-owner',
    '--no-acl',
    `--file=${backupPath}`,
  ], pgEnvironment);
  await chmod(backupPath, 0o600);
  await run(`${PG_BIN}/pg_restore`, ['--list', backupPath]);
  const metadata = await stat(backupPath);
  console.log(`Ruta: ${backupPath}`);
  console.log(`Tamaño: ${metadata.size} bytes`);
  console.log(`Fecha: ${metadata.mtime.toISOString()}`);
  console.log('Validación: correcta');
} catch (error) {
  await unlink(backupPath).catch(() => undefined);
  throw error;
}
