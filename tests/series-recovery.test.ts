import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [service, controller, router, validation, errorHandler] = await Promise.all([
  readFile(new URL('../src/services/series-recovery.service.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/controllers/hidden-user-series.controller.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/routes/api.router.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/validation/api-validation.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/middleware/request-observability.middleware.ts', import.meta.url), 'utf8'),
]);

test('recuperarSaga es POST autenticado y nunca acepta userId del cuerpo', () => {
  assert.match(router, /'recuperarSaga'/);
  assert.match(router, /case 'recuperarSaga':[\s\S]*!req\.auth[\s\S]*handleRecoverAbandonedSeries/);
  assert.match(controller, /recoverAbandonedSeries\(req\.auth!\.userId, req\.body\?\.sagaId\)/);
  assert.doesNotMatch(controller, /recoverAbandonedSeries\([\s\S]{0,40}body\?\.userId/);
});

test('recuperarSaga valida sagaId igual que el resto de acciones de sagas', () => {
  assert.match(validation, /recuperarSaga: idBody\('sagaId'\)/);
});

test('SeriesRecoveryError está reconocido por el manejador de errores global', () => {
  assert.match(errorHandler, /SeriesRecoveryError/);
});

test('recuperar solo actúa sobre libros ABANDONED de esa saga y de esa usuaria', () => {
  assert.match(service, /status: ReadingStatus\.ABANDONED/);
  assert.match(service, /book: \{ seriesId, deletedAt: null \}/);
  assert.match(service, /library\.findMany\(\{[\s\S]*userId,/);
});

test('recuperar reutiliza actualizarEstado en vez de escribir Library a mano', () => {
  assert.match(service, /actualizarEstado\(user\.name, book\.title, 'PENDIENTE'\)/);
  assert.doesNotMatch(service, /prisma\.library\.update(?:Many)?\(/);
});

test('recuperar exige que la saga exista', () => {
  assert.match(service, /SERIES_ID_REQUIRED/);
  assert.match(service, /SERIES_NOT_FOUND/);
});
