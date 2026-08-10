import assert from 'node:assert/strict';
import { access, readFile, readdir } from 'node:fs/promises';
import test from 'node:test';

test('las consultas prioritarias mantienen filtros, orden y límites seguros', async () => {
  const [readings, notifications, catalog, clubvision, profile, dashboard] = await Promise.all([
    'readings.service.ts', 'notifications.service.ts', 'catalog.service.ts',
    'clubvision.service.ts', 'perfil.service.ts', 'dashboard.service.ts',
  ].map((file) => readFile(new URL(`../src/services/${file}`, import.meta.url), 'utf8')));
  assert.match(readings, /conversationId: conversation\.id[\s\S]*parentId: null[\s\S]*deletedAt: null[\s\S]*ascendingCursorFilter/);
  assert.match(readings, /orderBy: \[\{ createdAt: 'asc' \}, \{ id: 'asc' \}\][\s\S]*take: pagination\.limit \+ 1/);
  assert.match(notifications, /userId[\s\S]*descendingCursorFilter\('createdAt'[\s\S]*take: pagination\.limit \+ 1/);
  assert.match(catalog, /deletedAt: null[\s\S]*descendingCursorFilter\('createdAt'[\s\S]*take: pagination\.limit \+ 1/);
  assert.match(clubvision, /clubId: club\.id[\s\S]*descendingCursorFilter\('createdAt'[\s\S]*take: pagination\.limit \+ 1/);
  assert.match(profile, /userId: user\.id[\s\S]*descendingCursorFilter\('finishedAt'[\s\S]*take: pagination\.limit \+ 1/);
  assert.match(dashboard, /isReread: false[\s\S]*bookId: \{ in: myBookIds \}[\s\S]*select: \{ userId: true, bookId: true \}/);
});

test('sin evidencia de latencia no queda DDL de índices preparado', async () => {
  await assert.rejects(access(
    new URL('../prisma/manual/20260809_performance_indexes.sql', import.meta.url),
  ));
  const migrations = await readdir(new URL('../prisma/migrations/', import.meta.url));
  assert.equal(migrations.some((name) => /performance.*index/i.test(name)), false);

  const report = await readFile(
    new URL('../PERFORMANCE_DIAGNOSTIC.md', import.meta.url),
    'utf8',
  );
  assert.match(report, /no hay ningún índice demostrado como necesario/i);
  assert.match(report, /No se crea migración/i);
});
