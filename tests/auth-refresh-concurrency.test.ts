import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const auth = await readFile(
  new URL('../src/services/auth.service.ts', import.meta.url),
  'utf8',
);

test('el refresh mantiene rotación atómica y distingue una renovación concurrente', () => {
  assert.match(auth, /authSession\.updateMany/);
  assert.match(auth, /refreshTokenHash: tokenHash/);
  assert.match(auth, /CONCURRENT_REFRESH_WINDOW_MS = 10_000/);
  assert.match(auth, /REFRESH_ALREADY_ROTATED/);
  assert.match(auth, /409/);
});

test('un token antiguo fuera de la ventana sigue siendo inválido', () => {
  assert.match(auth, /INVALID_REFRESH_TOKEN/);
  assert.match(auth, /Date\.now\(\) - rotatedSession\.lastUsedAt\.getTime\(\)/);
});
