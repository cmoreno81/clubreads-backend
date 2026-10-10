import assert from 'node:assert/strict';
import { test } from 'node:test';

import { prisma } from '../src/prisma.js';
import {
  amazonActivo,
  construirEnlaceAmazon,
  getEnlaceCompra,
} from '../src/services/enlace-compra.service.js';

function falso(modelo: string, metodos: Record<string, (...a: never[]) => unknown>) {
  const original = Object.getOwnPropertyDescriptor(prisma, modelo);
  Object.defineProperty(prisma, modelo, { value: metodos, configurable: true });
  return () => {
    if (original) Object.defineProperty(prisma, modelo, original);
    else delete (prisma as Record<string, unknown>)[modelo];
  };
}

const conCasaDelLibro = {
  title: 'Entre dos tormentas',
  isbn: null,
  language: 'es',
  deletedAt: null,
  author: { name: 'Lucía Marín' },
  storeLinks: [
    { format: 'PAPEL', url: 'https://www.casadellibro.com/libro-entre-dos-tormentas/9788400000000/1', language: 'es' },
  ],
  sources: [],
};
const soloAmazon = { ...conCasaDelLibro, storeLinks: [] };

async function pedir(libro: unknown, etiqueta: string | undefined) {
  const anterior = process.env.AMAZON_ASSOCIATE_TAG;
  if (etiqueta === undefined) delete process.env.AMAZON_ASSOCIATE_TAG;
  else process.env.AMAZON_ASSOCIATE_TAG = etiqueta;
  const restaurar = falso('book', { findUnique: async () => libro });
  try {
    return (await getEnlaceCompra('b1')) as Record<string, any>;
  } finally {
    restaurar();
    if (anterior === undefined) delete process.env.AMAZON_ASSOCIATE_TAG;
    else process.env.AMAZON_ASSOCIATE_TAG = anterior;
  }
}

test('sin AMAZON_ASSOCIATE_TAG Amazon está apagado y solo hay Casa del Libro', async () => {
  const r = await pedir(conCasaDelLibro, undefined);
  assert.equal(r.tiendas.length, 1);
  assert.equal(r.tiendas[0].tienda, 'Casa del Libro');
  assert.equal(r.tienda, 'Casa del Libro');
  assert.equal(r.exacto, true);
});

test('con la etiqueta y el libro en las dos tiendas, Casa del Libro va primero y Amazon después', async () => {
  const r = await pedir(conCasaDelLibro, 'clubreads-21');
  assert.deepEqual(r.tiendas.map((t: any) => t.tienda), ['Casa del Libro', 'Amazon']);
  const amazon = r.tiendas[1];
  assert.deepEqual(amazon.formatos.map((f: any) => [f.formato, f.etiqueta]), [['papel', 'Papel'], ['ebook', 'Kindle']]);
  for (const f of amazon.formatos) assert.match(f.url, /tag=clubreads-21/);
  assert.match(amazon.aviso, /Como afiliado de Amazon/);
  assert.match(amazon.aviso, /Publicidad/);
  // El nivel superior sigue siendo Casa del Libro para las apps antiguas.
  assert.equal(r.tienda, 'Casa del Libro');
  assert.match(r.url, /awin1\.com/);
});

test('un autopublicado solo en Amazon: Amazon primero, y las apps antiguas no ven compra', async () => {
  const r = await pedir(soloAmazon, 'clubreads-21');
  assert.equal(r.tiendas[0].tienda, 'Amazon');
  assert.equal(r.tiendas.find((t: any) => t.tienda === 'Casa del Libro').exacto, false);
  // Apps antiguas: el nivel superior es Casa del Libro sin ficha, así que no ofrecen nada
  // (no enseñan un enlace de Amazon con el nombre de otra tienda).
  assert.equal(r.tienda, 'Casa del Libro');
  assert.equal(r.exacto, false);
});

test('el enlace de Amazon busca por título y autora, en la categoría del formato y con la etiqueta', () => {
  process.env.AMAZON_ASSOCIATE_TAG = ' clubreads-21 ';
  try {
    const papel = new URL(construirEnlaceAmazon({ titulo: 'Entre dos tormentas', autora: 'Lucía Marín', formato: 'papel' }));
    assert.equal(papel.hostname, 'www.amazon.es');
    assert.equal(papel.searchParams.get('k'), 'Entre dos tormentas Lucía Marín');
    assert.equal(papel.searchParams.get('i'), 'stripbooks');
    assert.equal(papel.searchParams.get('tag'), 'clubreads-21');
    const ebook = new URL(construirEnlaceAmazon({ titulo: 'X', formato: 'ebook' }));
    assert.equal(ebook.searchParams.get('i'), 'digital-text');
    assert.equal(amazonActivo(), true);
  } finally {
    delete process.env.AMAZON_ASSOCIATE_TAG;
  }
  assert.equal(amazonActivo(), false);
});
