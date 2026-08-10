import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Request, Response } from 'express';
import { POST_ONLY_ACTIONS, handleApi } from '../src/routes/api.router.js';
import {
  actionBodySchemas,
  dateSchema,
  emailSchema,
  formatSchema,
  identifierSchema,
  pageSchema,
  progressSchema,
  ratingSchema,
  reactionSchema,
  validateActionInput,
} from '../src/validation/api-validation.js';

function response() {
  let statusCode = 200;
  let payload: unknown;
  const res = {
    status(code: number) { statusCode = code; return res; },
    json(value: unknown) { payload = value; return res; },
    set() { return res; },
  } as unknown as Response;
  return { res, state: () => ({ statusCode, payload }) };
}

function request(body: unknown, method = 'POST') {
  return { method, body, query: {} } as unknown as Request;
}

test('cada acción mutadora tiene un esquema propio', () => {
  assert.deepEqual(Object.keys(actionBodySchemas).sort(), [...POST_ONLY_ACTIONS].sort());
});

test('los esquemas comunes validan identificadores y normalizan email', () => {
  assert.equal(identifierSchema.safeParse('  ').success, false);
  assert.equal(emailSchema.parse('  PERSONA@Example.COM '), 'persona@example.com');
  assert.equal(emailSchema.safeParse('sin-arroba').success, false);
});

test('números rechazan NaN, Infinity, formatos absurdos y rangos inválidos', () => {
  for (const value of [NaN, Infinity, '12p', '', '1e999']) {
    assert.equal(pageSchema.safeParse(value).success, false);
  }
  assert.equal(pageSchema.safeParse('120').success, true);
  assert.equal(progressSchema.safeParse(101).success, false);
  assert.equal(ratingSchema.safeParse('5.1').success, false);
});

test('fechas imposibles, enums desconocidos y URLs excesivas se rechazan', () => {
  assert.equal(dateSchema.safeParse('2025-02-29').success, false);
  assert.equal(dateSchema.safeParse('2025-02-28T99:99:99Z').success, false);
  assert.equal(formatSchema.safeParse('PAPIRO').success, false);
  assert.equal(reactionSchema.safeParse('HACK').success, false);
  assert.equal(actionBodySchemas.actualizarAvatarPerfil.safeParse({ avatarUrl: `https://example.com/${'a'.repeat(2_100)}` }).success, false);
});

test('faltantes y límites de texto producen el contrato estable sin reflejar secretos', () => {
  const { res, state } = response();
  const secret = 'clave-super-secreta';
  validateActionInput('login', request({ password: secret }), res);
  assert.equal(state().statusCode, 400);
  assert.deepEqual(state().payload, {
    ok: false,
    error: 'VALIDATION_ERROR',
    mensaje: 'La petición contiene campos inválidos',
    campos: ['email'],
  });
  assert.doesNotMatch(JSON.stringify(state().payload), new RegExp(secret));
  assert.equal(actionBodySchemas.crearClub.safeParse({ nombre: 'x'.repeat(201) }).success, false);
});

test('compatibilidad Flutter: acepta números antiguos y nuevos y booleanos heredados', () => {
  assert.equal(actionBodySchemas.crearLectura.safeParse({ libro: 'book_1', capitulos: '24', paginas: 380, prologo: '1', epilogo: false, tipo: 'LIBRE' }).success, true);
  assert.equal(actionBodySchemas.actualizarProgresoLectura.safeParse({ libro: 'book_1', progreso: '42.5', paginaActual: '120', paginasTotales: 380, comentario: 'Avance' }).success, true);
  assert.equal(actionBodySchemas.editarLibro.safeParse({ id: 'book_1', titulo: 'Título', campoFlutterAdicional: true }).success, true);
  assert.equal(actionBodySchemas.guardarComentarioLectura.safeParse({ libro: 'book_1', capitulo: '3', texto: 'Comentario desde APK', tipo: 'COMMENT' }).success, true);
});

test('las importaciones rechazan filas no estructuradas y lotes excesivos', () => {
  assert.equal(actionBodySchemas.previsualizarImportacionGoodreads.safeParse({ libros: ['contenido inesperado'], source: 'GOODREADS' }).success, false);
  const row = { title: 'Libro' };
  assert.equal(actionBodySchemas.previsualizarImportacionGoodreads.safeParse({ libros: Array.from({ length: 2_001 }, () => row), source: 'GOODREADS' }).success, false);
  assert.equal(actionBodySchemas.previsualizarImportacionGoodreads.safeParse({ libros: [row], source: 'GOODREADS' }).success, true);
});

test('una petición privada sin token conserva 401 aunque el cuerpo sea inválido', async () => {
  const { res, state } = response();
  await handleApi(
    { method: 'POST', body: {}, query: { action: 'crearLibro' } } as unknown as Request,
    res,
    () => {},
  );
  assert.equal(state().statusCode, 401);
  assert.deepEqual(state().payload, { ok: false, error: 'AUTHENTICATION_REQUIRED', mensaje: 'Necesitas iniciar sesión' });
});
