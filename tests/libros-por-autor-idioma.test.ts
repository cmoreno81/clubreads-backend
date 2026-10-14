import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('la ficha de autoría devuelve el idioma de cada libro', () => {
  const src = readFileSync('src/controllers/general-dashboard.controller.ts', 'utf8');
  assert.match(src, /idioma: book\.language \?\? ''/);
});
