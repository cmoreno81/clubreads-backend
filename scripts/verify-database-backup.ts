import { chmod, mkdtemp, stat, unlink, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

import { assertOutsideRepository, runSafe } from './postgres-backup-common.js';

const encryptedPath = process.argv[2];
const identityFile = process.env.BACKUP_AGE_IDENTITY_FILE;
if (!encryptedPath) throw new Error('Indica el archivo .dump.age');
if (!identityFile) throw new Error('BACKUP_AGE_IDENTITY_FILE no está definida');
assertOutsideRepository(encryptedPath);

process.umask(0o077);
const root = await mkdtemp(join(tmpdir(), 'clubreads-backup-check-'));
await chmod(root, 0o700);
const temporaryDump = join(root, 'verified.dump');
try {
  await runSafe('age', [
    '--decrypt',
    '--identity',
    identityFile,
    '--output',
    temporaryDump,
    encryptedPath,
  ]);
  await chmod(temporaryDump, 0o600);
  await runSafe('pg_restore', ['--list', temporaryDump]);
  const metadata = await stat(encryptedPath);
  console.log(JSON.stringify({
    ok: true,
    file: basename(encryptedPath),
    bytes: metadata.size,
    customFormatVerified: true,
    encrypted: true,
  }));
} finally {
  await unlink(temporaryDump).catch(() => undefined);
  await rmdir(root).catch(() => undefined);
}
