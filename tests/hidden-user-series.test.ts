import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { excludeHiddenSeries } from '../src/services/hidden-user-series.service.js';

const [schema, migration, service, controller, router, profile, dashboard] = await Promise.all([
  readFile(new URL('../prisma/schema.prisma', import.meta.url), 'utf8'),
  readFile(new URL('../prisma/migrations/20260803160000_add_hidden_user_series/migration.sql', import.meta.url), 'utf8'),
  readFile(new URL('../src/services/hidden-user-series.service.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/controllers/hidden-user-series.controller.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/routes/api.router.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/services/perfil.service.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/services/general-dashboard.service.ts', import.meta.url), 'utf8'),
]);

test('la preferencia es persistente y única por usuaria y saga', () => {
  assert.match(schema, /model HiddenUserSeries/);
  assert.match(schema, /@@unique\(\[userId, seriesId\]\)/);
  assert.match(migration, /CREATE UNIQUE INDEX "HiddenUserSeries_userId_seriesId_key"/);
  assert.match(migration, /REFERENCES "User"/);
  assert.match(migration, /REFERENCES "Series"/);
});

test('ocultar y mostrar saga son POST autenticados y nunca aceptan userId del cuerpo', () => {
  assert.match(router, /'ocultarSaga'/);
  assert.match(router, /'mostrarSaga'/);
  assert.match(router, /case 'ocultarSaga':[\s\S]*!req\.auth[\s\S]*handleHideSeries/);
  assert.match(router, /case 'mostrarSaga':[\s\S]*!req\.auth[\s\S]*handleShowSeries/);
  assert.match(controller, /hideUserSeries\(req\.auth!\.userId, req\.body\?\.sagaId\)/);
  assert.match(controller, /showUserSeries\(req\.auth!\.userId, req\.body\?\.sagaId\)/);
  assert.doesNotMatch(controller, /body\?\.userId/);
});

test('ocultar exige que la saga exista y pertenezca a biblioteca o historial', () => {
  assert.match(service, /library: \{ some: \{ userId \} \}/);
  assert.match(service, /readingCompletions: \{ some: \{ userId \} \}/);
  assert.match(service, /SERIES_NOT_FOUND/);
  assert.match(service, /SERIES_NOT_IN_USER_HISTORY/);
});

test('ocultar y mostrar son idempotentes', () => {
  assert.match(service, /hiddenUserSeries\.upsert/);
  assert.match(service, /hiddenUserSeries\.deleteMany/);
  assert.match(service, /return \{ ok: true, sagaId: seriesId \}/);
});

test('dos usuarias pueden obtener sagas diferentes sin alterar sus libros', () => {
  const series = [
    { id: 'saga-1', nombre: 'Saga compartida', books: [{ id: 'book-1', rating: 5 }] },
    { id: 'saga-2', nombre: 'Otra saga', books: [{ id: 'book-2', rating: 4 }] },
  ];
  const snapshot = structuredClone(series);
  assert.deepEqual(excludeHiddenSeries(series, new Set(['saga-1'])).map(({ id }) => id), ['saga-2']);
  assert.deepEqual(excludeHiddenSeries(series, new Set()).map(({ id }) => id), ['saga-1', 'saga-2']);
  assert.deepEqual(series, snapshot);
});

test('perfil, contador y dashboard excluyen únicamente IDs ocultos', () => {
  assert.match(profile, /prisma\.hiddenUserSeries\.findMany/);
  assert.match(profile, /!hiddenSeriesIds\.has\(item\.book\.series\.id\)/);
  assert.match(profile, /sagasAbiertas: sagas\.filter/);
  assert.match(dashboard, /prisma\.hiddenUserSeries\.findMany/);
  assert.match(dashboard, /!hiddenSeriesIds\.has\(item\.book\.series\.id\)/);
  assert.match(dashboard, /sagasAbiertas: openSeries/);
});

test('la operación no escribe ni elimina libros, lecturas, reseñas o bibliotecas', () => {
  assert.doesNotMatch(service, /prisma\.(?:book|library|readingCompletion|review)\.(?:create|update|delete)/);
  assert.doesNotMatch(service, /tx\.(?:book|library|readingCompletion|review)/);
});
