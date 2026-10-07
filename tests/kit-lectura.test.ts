import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { KIT_MAX_BYTES, kitEsValido } from '../src/services/kit-lectura.service.js';

const schema = readFileSync(new URL('../prisma/schema.prisma', import.meta.url), 'utf8');
const servicio = readFileSync(new URL('../src/services/kit-lectura.service.ts', import.meta.url), 'utf8');
const router = readFileSync(new URL('../src/routes/api.router.ts', import.meta.url), 'utf8');
const migracion = readFileSync(
  new URL('../prisma/migrations/20261007220000_reading_kit/migration.sql', import.meta.url),
  'utf8',
);

test('el kit es un objeto pequeño; arrays, texto y kits enormes se rechazan', () => {
  assert.equal(kitEsValido({ paleta: ['#fff'], atmosferaId: 'bosque' }), true);
  assert.equal(kitEsValido({}), true);
  assert.equal(kitEsValido(null), false);
  assert.equal(kitEsValido('texto'), false);
  assert.equal(kitEsValido([1, 2]), false);
  assert.equal(kitEsValido({ x: 'a'.repeat(KIT_MAX_BYTES) }), false);
});

test('ReadingKit guarda un kit por lectora y libro, borrado en cascada, con migración', () => {
  const modelo = schema.match(/model ReadingKit \{[\s\S]*?\n\}/)?.[0] ?? '';
  assert.match(modelo, /@@unique\(\[userId, bookId\]\)/);
  assert.match(modelo, /data\s+Json/);
  assert.match(modelo, /onDelete: Cascade/);
  assert.match(migracion, /CREATE TABLE "ReadingKit"/);
  assert.match(migracion, /CREATE UNIQUE INDEX "ReadingKit_userId_bookId_key"/);
});

test('cada lectora solo lee y escribe su propio kit', () => {
  assert.match(servicio, /userId_bookId: \{ userId, bookId: resolvedId \}/);
  assert.match(servicio, /upsert\(\{\s*where: \{ userId_bookId: \{ userId, bookId: libro\.id \} \}/);
  assert.match(router, /case 'kitLectura':\s*return handleGetKitLectura/);
  assert.match(router, /case 'guardarKitLectura':\s*return handleGuardarKitLectura/);
  const controlador = readFileSync(new URL('../src/controllers/books.controller.ts', import.meta.url), 'utf8');
  assert.match(controlador, /getKitLectura\(req\.auth!\.userId/);
  assert.match(controlador, /guardarKitLectura\(req\.auth!\.userId/);
});
