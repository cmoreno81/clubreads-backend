import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const schema = readFileSync('prisma/schema.prisma', 'utf8');
const migration = readFileSync(
  'prisma/migrations/20260729113000_add_personal_reading_format/migration.sql',
  'utf8',
);
const service = readFileSync('src/services/books.service.ts', 'utf8');
const routes = readFileSync('src/routes/api.router.ts', 'utf8');
const seriesMerge = readFileSync(
  'prisma/migrations/20260729144500_merge_windy_city_series/migration.sql',
  'utf8',
);

test('el formato es personal y cada finalización conserva una copia', () => {
  assert.match(schema, /model Library[\s\S]*readingFormat ReadingFormat\?/);
  assert.match(
    schema,
    /model ReadingCompletion[\s\S]*readingFormat ReadingFormat\?/,
  );
  assert.match(service, /readingFormat: requestedFormat \?\? currentLibrary/);
});

test('la migración es compatible: añade campos opcionales', () => {
  assert.match(migration, /ADD COLUMN "readingFormat"/);
  assert.doesNotMatch(migration, /NOT NULL/);
});

test('las preferencias se actualizan sin modificar el libro compartido', () => {
  assert.match(routes, /case 'actualizarPreferenciasLibro'/);
  assert.match(service, /tx\.library|prisma\.library\.update/);
});

test('los libros finalizados indican si pertenecen a la sesión actual', () => {
  assert.match(service, /yaLoTengo: item\.userId === user\?\.id/);
});

test('las sagas toleran pequeñas erratas y Windy City queda unificada', () => {
  assert.match(service, /distanciaEdicion/);
  assert.match(service, /buscarOCrearSaga/);
  assert.match(seriesMerge, /'windy city', 'wyndy city'/);
  assert.match(seriesMerge, /UPDATE "Book"/);
});

test('editar solo las mayúsculas renombra y reúne sagas equivalentes', () => {
  assert.match(service, /preferredSeriesId/);
  assert.match(service, /name: nombre/);
  assert.match(service, /seriesId:\s*\{\s*in:/);
  assert.match(service, /tx\.series\.deleteMany/);
});
