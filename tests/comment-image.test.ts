import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { actionBodySchemas } from '../src/validation/api-validation.js';

const base = { libro: 'book_1', capitulo: '3', tipo: 'COMMENT' };
const pixel = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';

test('un comentario puede llevar solo una foto, sin texto', () => {
  const schema = actionBodySchemas.guardarComentarioLectura;
  assert.equal(schema.safeParse({ ...base, imagen: pixel }).success, true);
  assert.equal(schema.safeParse({ ...base, comentario: 'Mira', imagen: pixel }).success, true);
});

test('sin texto ni foto el comentario sigue siendo obligatorio', () => {
  assert.equal(actionBodySchemas.guardarComentarioLectura.safeParse(base).success, false);
});

test('la foto debe ser un data URL de imagen y no pasar de 4 MB', () => {
  const schema = actionBodySchemas.guardarComentarioLectura;
  assert.equal(
    schema.safeParse({ ...base, comentario: 'Hola', imagen: 'https://ejemplo.com/a.jpg' }).success,
    false,
  );
  assert.equal(
    schema.safeParse({ ...base, comentario: 'Hola', imagen: `data:image/jpeg;base64,${'A'.repeat(4 * 1024 * 1024)}` }).success,
    false,
  );
});

test('la foto se sube a Cloudinary, se devuelve en los listados y se borra con el comentario', async () => {
  const service = await readFile(new URL('../src/services/readings.service.ts', import.meta.url), 'utf8');
  const cloud = await readFile(new URL('../src/services/cloudinary.service.ts', import.meta.url), 'utf8');
  // Se guarda al crear
  assert.match(service, /imageUrl: imagen\?\.url \?\? null/);
  assert.match(service, /imagePublicId: imagen\?\.publicId \?\? null/);
  // Se devuelve en los tres puntos que montan comentarios
  assert.equal((service.match(/imagenUrl: (comment|created)\.imageUrl \?\? ''/g) ?? []).length, 3);
  // La consulta paginada la selecciona
  const paginated = service.slice(service.indexOf('export async function getComentariosLecturaPage'));
  assert.match(paginated, /imageUrl: true/);
  // Al eliminar se limpia en base de datos y en Cloudinary
  const eliminar = service.slice(service.indexOf('export async function eliminarComentarioLectura'));
  assert.match(eliminar, /imagePublicId: null/);
  assert.match(eliminar, /borrarImagenCloudinary\(existing\.imagePublicId\)/);
  // Las fotos de comentarios van a su carpeta y se reducen
  assert.match(cloud, /folder: 'clubreads\/comments'/);
  assert.match(cloud, /crop: 'limit'/);
});

test('al eliminar la cuenta se retiran las fotos de sus comentarios y sus temas personalizados', async () => {
  const auth = await readFile(new URL('../src/services/auth.service.ts', import.meta.url), 'utf8');
  const eliminar = auth.slice(auth.indexOf('export async function eliminarCuenta'));
  assert.match(eliminar, /imagePublicId: \{ not: null \}/);
  assert.match(eliminar, /data: \{ imageUrl: null, imagePublicId: null \}/);
  assert.match(eliminar, /commentCategories: Prisma\.DbNull/);
  assert.match(eliminar, /borrarImagenCloudinary\(imagePublicId\)/);
});
