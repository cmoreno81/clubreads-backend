import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

import {
  assertOutsideRepository,
  assertSafeRestoreTarget,
  postgresEnvironment,
} from '../scripts/postgres-backup-common.js';

test('restore solo admite host local y nombre inequívoco de prueba', () => {
  assert.equal(
    assertSafeRestoreTarget('postgresql://user:secret@127.0.0.1:5432/clubreads_restore_test'),
    'clubreads_restore_test',
  );
  assert.throws(() => assertSafeRestoreTarget(
    'postgresql://user:secret@example.com/clubreads_restore_test',
  ));
  assert.throws(() => assertSafeRestoreTarget(
    'postgresql://user:secret@localhost/clubreads',
  ));
});

test('el backup no puede escribirse dentro del repositorio', () => {
  assert.throws(() => assertOutsideRepository('backups/copy.dump'));
  assert.ok(assertOutsideRepository('/private/tmp/clubreads-secure-backups'));
});

test('DATABASE_URL no se propaga a procesos hijos', async () => {
  const environment = postgresEnvironment(
    'postgresql://user:secret@localhost:5432/clubreads_restore_test?sslmode=disable',
  );
  assert.equal(environment.DATABASE_URL, undefined);
  assert.equal(environment.PGDATABASE, 'clubreads_restore_test');

  const sources = await Promise.all([
    readFile(new URL('../scripts/backup-database.ts', import.meta.url), 'utf8'),
    readFile(new URL('../scripts/restore-database-backup.ts', import.meta.url), 'utf8'),
  ]);
  assert.doesNotMatch(sources.join('\n'), /console\.log\([^\n]*DATABASE_URL/);
  assert.match(sources[0], /--format=custom/);
  assert.match(sources[1], /--single-transaction/);
});

test('Git y Docker excluyen dumps y backups', async () => {
  const [gitignore, dockerignore] = await Promise.all([
    readFile(new URL('../.gitignore', import.meta.url), 'utf8'),
    readFile(new URL('../.dockerignore', import.meta.url), 'utf8'),
  ]);
  for (const pattern of ['*.dump', '*.dump.age', '*.backup', '*.backup.age']) {
    assert.ok(gitignore.includes(pattern));
    assert.ok(dockerignore.includes(pattern));
  }
});
