import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { prisma } from '../src/prisma.js';
import {
  getEnlacesCompraLote,
  setLoTengo,
} from '../src/services/enlace-compra.service.js';

/// Sustituye un modelo de prisma por uno falso durante una prueba.
function falso(modelo: string, metodos: Record<string, (...a: never[]) => unknown>) {
  const original = Object.getOwnPropertyDescriptor(prisma, modelo);
  Object.defineProperty(prisma, modelo, { value: metodos, configurable: true });
  return () => {
    if (original) Object.defineProperty(prisma, modelo, original);
    else delete (prisma as Record<string, unknown>)[modelo];
  };
}

const schema = readFileSync(new URL('../prisma/schema.prisma', import.meta.url), 'utf8');
const router = readFileSync(new URL('../src/routes/api.router.ts', import.meta.url), 'utf8');

test('Library guarda "owned" por lectora y libro, con migración', () => {
  const lib = schema.match(/model Library \{[\s\S]*?\n\}/)?.[0];
  assert.match(lib ?? '', /owned\s+Boolean\s+@default\(false\)/);
  const sql = readFileSync(
    new URL('../prisma/migrations/20261007120000_library_owned/migration.sql', import.meta.url),
    'utf8',
  );
  assert.match(sql, /ADD COLUMN "owned" BOOLEAN NOT NULL DEFAULT false/);
});

test('las rutas de marcar y desmarcar exigen sesión', () => {
  assert.match(router, /put\('\/libros\/:bookId\/lo-tengo', requireAuthentication/);
  assert.match(router, /delete\('\/libros\/:bookId\/lo-tengo', requireAuthentication/);
});

test('setLoTengo solo cambia "owned" de la biblioteca de esa lectora', async () => {
  const llamadas: unknown[] = [];
  const restaurar = falso('library', {
    updateMany: async (arg: unknown) => {
      llamadas.push(arg);
      return { count: 1 };
    },
  });
  try {
    assert.deepEqual(await setLoTengo('u1', 'b1', true), { ok: true, loTengo: true });
    const llamada = llamadas[0] as { where: unknown; data: { owned: boolean; ownedAt: Date | null } };
    assert.deepEqual(llamada.where, { userId: 'u1', bookId: 'b1' });
    assert.equal(llamada.data.owned, true);
    assert.ok(llamada.data.ownedAt instanceof Date);
  } finally {
    restaurar();
  }
});

test('setLoTengo avisa si el libro no está en la biblioteca', async () => {
  const restaurar = falso('library', { updateMany: async () => ({ count: 0 }) });
  try {
    assert.equal((await setLoTengo('u1', 'b1', true)).ok, false);
  } finally {
    restaurar();
  }
});

test('el lote marca loTengo si lo marcó o si compró el deseo', async () => {
  const libro = (id: string) => ({
    id,
    title: id,
    isbn: null,
    language: 'es',
    author: null,
    storeLinks: [],
    sources: [],
  });
  const fin = [
    falso('book', { findMany: async () => [libro('a'), libro('b'), libro('c')] }),
    falso('library', {
      findMany: async () => [
        { bookId: 'a', readingFormat: null, personalLanguage: null, owned: true },
        { bookId: 'b', readingFormat: null, personalLanguage: null, owned: false },
      ],
    }),
    falso('wishlistItem', { findMany: async () => [{ bookId: 'b' }] }),
  ];
  try {
    const r = await getEnlacesCompraLote(['a', 'b', 'c'], 'u1');
    assert.equal(r.enlaces['a']!.loTengo, true);
    assert.equal(r.enlaces['b']!.loTengo, true);
    assert.equal(r.enlaces['c']!.loTengo, false);
  } finally {
    fin.forEach((f) => f());
  }
});

test('corregir el formato de un libro terminado toca solo la finalización y la biblioteca de la lectora', () => {
  const servicio = readFileSync(new URL('../src/services/books.service.ts', import.meta.url), 'utf8');
  const fn = servicio.match(/export async function actualizarFormatoLibro[\s\S]*?\n\}\n/)?.[0] ?? '';
  assert.match(fn, /readingCompletion\.update\(\{\s*where: \{ id: finalizacion\.id \},\s*data: \{ readingFormat: formato \}/);
  assert.match(fn, /library\.updateMany\(\{\s*where: \{ userId: user\.id, bookId: resolvedBookId \}/);
  assert.doesNotMatch(fn, /prisma\.book\./);
  assert.match(router, /case 'actualizarFormatoLibro':/);
});
