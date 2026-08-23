import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(
  new URL('../src/services/books.service.ts', import.meta.url),
  'utf8',
);
const validation = fs.readFileSync(
  new URL('../src/validation/api-validation.ts', import.meta.url),
  'utf8',
);

test('el contrato de libro acepta y valida coverUrl explícitamente', () => {
  assert.match(validation, /coverUrl:\s*urlSchema\.optional\(\)/);
});

test('crearLibro prioriza la portada manual frente a la automática', () => {
  assert.match(
    source,
    /suppliedCoverUrl\s*\|\|\s*automaticCover\?\.coverUrl\s*\|\|\s*null/,
  );
});

test('crearLibro completa la portada de una ficha existente que no la tenía', () => {
  assert.match(
    source,
    /!existingBook\.coverUrl\?\.trim\(\)\s*&&\s*suppliedCoverUrl/,
  );
  assert.match(source, /data:\s*\{\s*coverUrl:\s*suppliedCoverUrl\s*\}/);
});
