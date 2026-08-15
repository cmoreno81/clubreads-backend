import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [service, controller, router, validation] = await Promise.all([
  readFile(new URL('../src/services/perfil.service.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/controllers/perfil.controller.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/routes/api.router.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/validation/api-validation.ts', import.meta.url), 'utf8'),
]);

test('reemplazarFavorito usa la sesión y está registrado como POST validado', () => {
  assert.match(controller, /reemplazarFavorito\(\{[\s\S]*usuario: requestUserName\(req\)/);
  assert.match(router, /POST_ONLY_ACTIONS[\s\S]*'reemplazarFavorito'/);
  assert.match(router, /case 'reemplazarFavorito':[\s\S]*handleReemplazarFavorito/);
  assert.match(validation, /reemplazarFavorito: body\(\{ bookIdActual: identifierSchema, bookIdNuevo: identifierSchema \}\)/);
});

test('la sustitución es una transacción que mantiene cinco favoritos', () => {
  const replacement = service.slice(service.indexOf('export async function reemplazarFavorito'));
  assert.match(replacement, /prisma\.\$transaction\(async \(tx\)/);
  assert.match(replacement, /actual\?\.isFavorite/);
  assert.match(replacement, /!nuevo/);
  assert.match(replacement, /nuevo\.isFavorite/);
  assert.match(replacement, /totalFavoritos > MAX_FAVORITOS/);
  assert.match(replacement, /data: \{ isFavorite: false \}/);
  assert.match(replacement, /data: \{ isFavorite: true, updatedAt: actual\.updatedAt \}/);
});
