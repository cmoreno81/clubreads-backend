import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const schema = readFileSync('prisma/schema.prisma', 'utf8');
const profile = readFileSync('src/services/perfil.service.ts', 'utf8');
const routes = readFileSync('src/routes/api.router.ts', 'utf8');

test('el estado editorial se añade sin romper las sagas existentes', () => {
  assert.match(schema, /publicationStatus SeriesPublicationStatus @default\(UNKNOWN\)/);
  assert.match(schema, /UNKNOWN\s+ONGOING\s+COMPLETED/s);
});

test('completada exige confirmación editorial y todos los volúmenes leídos', () => {
  assert.match(profile, /series\.publicationStatus === 'COMPLETED'/);
  assert.match(profile, /allKnownVolumesRead[\s\S]*!hasPreviousGaps/);
  assert.match(profile, /estadoEditorial: series\.publicationStatus/);
});

test('editar el estado editorial requiere una sesión autenticada', () => {
  assert.match(routes, /'actualizarEstadoEditorialSaga'/);
  assert.match(
    routes,
    /case 'actualizarEstadoEditorialSaga':[\s\S]*if \(!req\.auth\)[\s\S]*requireAuthentication/,
  );
});
