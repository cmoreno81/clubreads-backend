import 'dotenv/config';

import { createHash } from 'node:crypto';
import { chmod, mkdir, stat, unlink } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';

import {
  assertOutsideRepository,
  postgresEnvironment,
  runSafe,
} from './postgres-backup-common.js';

const connectionString = process.env.DATABASE_URL;
const backupDirectory = process.env.BACKUP_DIR;
const ageRecipient = process.env.BACKUP_AGE_RECIPIENT;
if (!connectionString) throw new Error('DATABASE_URL no está definida');
if (!backupDirectory) throw new Error('BACKUP_DIR no está definida');
if (!ageRecipient) throw new Error('BACKUP_AGE_RECIPIENT no está definida');
if (process.env.BACKUP_CONFIRM_READ_ONLY !== 'YES') {
  throw new Error('Confirma la operación de solo lectura con BACKUP_CONFIRM_READ_ONLY=YES');
}

process.umask(0o077);
const destination = assertOutsideRepository(backupDirectory);
await mkdir(destination, { recursive: true, mode: 0o700 });
await chmod(destination, 0o700);

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const baseName = `clubreads-${stamp}.dump`;
const temporaryDump = join(destination, `.${baseName}.part`);
const encryptedDump = join(destination, `${baseName}.age`);
const postgresEnv = postgresEnvironment(connectionString);
const startedAt = performance.now();

try {
  await runSafe('pg_dump', [
    '--format=custom',
    '--no-owner',
    '--no-acl',
    `--file=${temporaryDump}`,
  ], postgresEnv);
  await chmod(temporaryDump, 0o600);
  await runSafe('pg_restore', ['--list', temporaryDump], postgresEnv);
  await runSafe('age', [
    '--recipient',
    ageRecipient,
    '--output',
    encryptedDump,
    temporaryDump,
  ]);
  await chmod(encryptedDump, 0o600);

  const hash = createHash('sha256');
  for await (const chunk of createReadStream(encryptedDump)) hash.update(chunk);
  const metadata = await stat(encryptedDump);
  console.log(JSON.stringify({
    ok: true,
    file: `${baseName}.age`,
    bytes: metadata.size,
    sha256: hash.digest('hex'),
    backupDurationMs: Math.round(performance.now() - startedAt),
    formatVerified: true,
    encrypted: true,
  }));
} finally {
  await unlink(temporaryDump).catch(() => undefined);
}
