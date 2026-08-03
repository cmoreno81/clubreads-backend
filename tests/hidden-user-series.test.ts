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

test('sagasOcultas es GET autenticado y obtiene la usuaria solo de la sesión', () => {
  assert.match(router, /case 'sagasOcultas':[\s\S]*!req\.auth[\s\S]*handleGetHiddenSeries/);
  assert.doesNotMatch(router, /POST_ONLY_ACTIONS[\s\S]{0,400}'sagasOcultas'/);
  assert.match(controller, /getHiddenUserSeries\(req\.auth!\.userId\)/);
  assert.doesNotMatch(controller, /query\.usuario|body\?\.userId/);
});

test('lista solo preferencias propias, con saga activa y orden alfabético', () => {
  assert.match(service, /hiddenUserSeries\.findMany/);
  assert.match(service, /where: \{[\s\S]*userId,[\s\S]*books: \{ some: \{ deletedAt: null \} \}/);
  assert.match(service, /orderBy: \{[\s\S]*series: \{ name: 'asc' \}/);
  assert.match(service, /sagas: preferences\.map/);
  assert.match(service, /nombre: series\.name/);
});

test('dos usuarias pueden tener listas ocultas distintas y una tercera ninguna', () => {
  const preferences = new Map([
    ['user-a', [{ id: 'series-a', nombre: 'Alfa' }]],
    ['user-b', [{ id: 'series-b', nombre: 'Beta' }]],
  ]);
  assert.deepEqual(preferences.get('user-a'), [{ id: 'series-a', nombre: 'Alfa' }]);
  assert.deepEqual(preferences.get('user-b'), [{ id: 'series-b', nombre: 'Beta' }]);
  assert.deepEqual(preferences.get('user-c') ?? [], []);
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

test('restaurar dos veces solo elimina la preferencia personal', () => {
  assert.match(service, /hiddenUserSeries\.deleteMany\(\{ where: \{ userId, seriesId \} \}\)/);
  assert.doesNotMatch(service, /hiddenUserSeries\.delete\(/);
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

test('al restaurar, perfil y dashboard vuelven a incluir la saga por ausencia del ID oculto', () => {
  const saga = [{ id: 'restored', nombre: 'Restaurada' }];
  assert.deepEqual(excludeHiddenSeries(saga, new Set()), saga);
  assert.match(profile, /!hiddenSeriesIds\.has\(item\.book\.series\.id\)/);
  assert.match(dashboard, /!hiddenSeriesIds\.has\(item\.book\.series\.id\)/);
});

test('la operación no escribe ni elimina libros, lecturas, reseñas o bibliotecas', () => {
  assert.doesNotMatch(service, /prisma\.(?:book|library|readingCompletion|review)\.(?:create|update|delete)/);
  assert.doesNotMatch(service, /tx\.(?:book|library|readingCompletion|review)/);
});
