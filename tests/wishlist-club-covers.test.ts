import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(
  new URL('../src/services/wishlist.service.ts', import.meta.url),
  'utf8',
);

test('la wishlist del club recupera la portada del catálogo vinculado', () => {
  assert.match(source, /book:\s*\{[\s\S]*coverUrl:\s*true/);
  assert.match(
    source,
    /item\.coverUrl\?\.trim\(\)\s*\|\|\s*item\.book\?\.coverUrl\?\.trim\(\)/,
  );
});

test('la wishlist pública muestra solo compras todavía pendientes', () => {
  assert.match(
    source,
    /userId:\s*\{\s*in:\s*memberUserIds\s*\},\s*purchasedAt:\s*null/,
  );
});

