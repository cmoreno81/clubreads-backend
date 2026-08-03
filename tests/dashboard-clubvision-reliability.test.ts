import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [dashboard, clubvision, schema, migration] = await Promise.all([
  readFile(new URL('../src/services/general-dashboard.service.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/services/clubvision.service.ts', import.meta.url), 'utf8'),
  readFile(new URL('../prisma/schema.prisma', import.meta.url), 'utf8'),
  readFile(new URL('../prisma/migrations/20260803193000_optimize_dashboard_clubvision/migration.sql', import.meta.url), 'utf8'),
]);

test('dashboardGeneral entrega sagas completas, limitadas y sin cargar perfilUsuario', () => {
  assert.match(dashboard, /sagasAbiertas: openSeries/);
  assert.match(dashboard, /estado,/);
  assert.match(dashboard, /coverUrl: next\.coverUrl\?\.trim\(\) \|\| representativeCover/);
  assert.match(dashboard, /enMiBiblioteca: libraryByBookId\.has\(next\.id\)/);
  assert.match(dashboard, /const priority = \{ EN_CURSO: 0, PENDIENTE: 1 \}/);
  assert.match(dashboard, /!hiddenSeriesIds\.has\(item\.book\.series\.id\)/);
  assert.match(dashboard, /\.slice\(0, 6\)/);
  assert.doesNotMatch(dashboard, /perfilUsuario|getPerfil/);
});

test('las consultas masivas principales tienen límites e índices adecuados', () => {
  assert.match(dashboard, /orderBy: \{ createdAt: 'desc' \},\s*take: 100/);
  assert.match(schema, /@@index\(\[bookId, status\]\)/);
  assert.match(schema, /@@index\(\[clubId, type, status\]\)/);
  assert.match(migration, /Library_bookId_status_idx/);
  assert.match(migration, /Reading_clubId_type_status_idx/);
});

test('el cambio mensual usa transacción acotada y registra el contexto del cron', () => {
  assert.match(clubvision, /maxWait: 5_000/);
  assert.match(clubvision, /timeout: 15_000/);
  assert.match(clubvision, /clubvision_cron_failed/);
  assert.match(clubvision, /clubId: club\.id/);
  assert.match(clubvision, /edition: calendar\.edition/);
  assert.match(clubvision, /phase: getClubvisionStage/);
});
