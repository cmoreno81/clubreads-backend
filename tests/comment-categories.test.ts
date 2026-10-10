import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  categoriasValidas,
  limpiarTextoCorto,
} from '../src/services/comment-categories.service.js';
import { actionBodySchemas } from '../src/validation/api-validation.js';

const cinco = [
  { emoji: '⭐', nombre: 'Momento fav.' },
  { emoji: '💭', nombre: 'Teoría' },
  { emoji: '🗣️', nombre: 'Cita del libro' },
  { emoji: '🎭', nombre: 'Villanos' },
  { emoji: '⚡', nombre: 'Giros' },
];

test('acepta exactamente 5 categorías con nombre', () => {
  assert.deepEqual(categoriasValidas(cinco), cinco);
  assert.equal(categoriasValidas(cinco.slice(0, 4)), null);
  assert.equal(categoriasValidas([...cinco, cinco[0]]), null);
  assert.equal(categoriasValidas('no'), null);
  assert.equal(categoriasValidas(null), null);
});

test('rechaza un nombre vacío y recorta el exceso', () => {
  const sinNombre = cinco.map((c, i) => (i === 1 ? { ...c, nombre: '   ' } : c));
  assert.equal(categoriasValidas(sinNombre), null);
  const largo = cinco.map((c, i) => (i === 0 ? { ...c, nombre: 'x'.repeat(80) } : c));
  assert.equal(categoriasValidas(largo)![0].nombre.length, 24);
});

test('limpia caracteres de control y espacios repetidos', () => {
  assert.equal(limpiarTextoCorto('  Mis \n  villanos\u0007 ', 40), 'Mis villanos');
  assert.equal(limpiarTextoCorto(undefined, 40), '');
});

test('la acción de guardar valida 5 categorías o null para restablecer', () => {
  const schema = actionBodySchemas.guardarCategoriasComentario;
  assert.equal(schema.safeParse({ categorias: cinco }).success, true);
  assert.equal(schema.safeParse({ categorias: null }).success, true);
  assert.equal(schema.safeParse({ categorias: cinco.slice(1) }).success, false);
});

test('el comentario guarda la etiqueta y la devuelve en los listados', async () => {
  const service = await readFile(new URL('../src/services/readings.service.ts', import.meta.url), 'utf8');
  assert.match(service, /typeLabel: etiqueta/);
  assert.equal((service.match(/etiqueta: (comment|created)\.typeLabel \?\? ''/g) ?? []).length, 3);
  const paginated = service.slice(service.indexOf('export async function getComentariosLecturaPage'));
  assert.match(paginated, /typeLabel: true/);
  // Un comentario libre no lleva etiqueta.
  assert.match(service, /tipo !== 'COMMENT' \? limpiarTextoCorto\(data\.etiqueta, 40\)/);
});

test('las categorías se piden por GET y se guardan por POST', async () => {
  const router = await readFile(new URL('../src/routes/api.router.ts', import.meta.url), 'utf8');
  assert.match(router, /case 'categoriasComentario':\s*return handleGetCategoriasComentario/);
  assert.match(router, /case 'guardarCategoriasComentario':\s*return handleGuardarCategoriasComentario/);
  assert.match(router, /'guardarCategoriasComentario',\s*\n\s*'responderComentario'/);
});
