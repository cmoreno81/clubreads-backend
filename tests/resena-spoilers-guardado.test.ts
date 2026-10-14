import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { actionBodySchemas } from '../src/validation/api-validation.js';

test('terminar un libro y editar la reseña aceptan «contiene spoilers» (y solo un sí/no)', () => {
  const estado = actionBodySchemas['actualizarEstado']!;
  const base = { libro: 'Yesteryear', estado: 'FINALIZADO', valoracion: '4' };
  assert.equal(estado.safeParse({ ...base, reflexion: 'x', contieneSpoilers: true }).success, true);
  assert.equal(estado.safeParse({ ...base, contieneSpoilers: 'quizá' }).success, false);
  const fechas = actionBodySchemas['actualizarFechasLectura']!;
  assert.equal(fechas.safeParse({ libraryId: 'l1', fechaInicio: '2026-10-01', fechaFin: '2026-10-05', contieneSpoilers: false }).success, true);
});

test('las tres vías que guardan una reseña guardan el aviso de spoilers y, si no llega, lo conservan', () => {
  const libros = readFileSync('src/services/books.service.ts', 'utf8');
  assert.match(libros, /containsSpoilers: contieneSpoilers \?\? false/); // terminar un libro
  assert.match(libros, /contieneSpoilers === undefined \? \{\} : \{ containsSpoilers: contieneSpoilers \}/);
  assert.match(libros, /typeof params\.contieneSpoilers === 'boolean' \? \{ containsSpoilers: params\.contieneSpoilers \}/); // editar valoración
  const perfil = readFileSync('src/services/perfil.service.ts', 'utf8');
  assert.match(perfil, /typeof params\.contieneSpoilers === 'boolean' \? \{ containsSpoilers: params\.contieneSpoilers \}/); // editar lectura
  assert.match(readFileSync('src/controllers/books.controller.ts', 'utf8'), /contieneSpoilers/);
  assert.match(readFileSync('src/controllers/perfil.controller.ts', 'utf8'), /contieneSpoilers: body\.contieneSpoilers/);
});
