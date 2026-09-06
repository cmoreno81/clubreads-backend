/**
 * Fusión: Quicksilver (Neal Stephenson, mal enlazado) → Quicksilver (Callie Hart)
 *
 * Libro definitivo (se conserva): Quicksilver, de Callie Hart
 *   id: cmtk5m4s200o82cqnsa56wfzb
 *   Saga real: "Fae & Alchemy" (cmrd84lot001bin50tj2vkbml), junto a "Brimstone"
 *
 * Libro duplicado (se absorbe y borra): Quicksilver, de Neal Stephenson
 *   id: cmrd84lzc00blin5023c9moyg
 *   Estaba mal enlazado como volumen 1/3 de "Fae & Alchemy" — es una novela
 *   histórica sin relación con la saga; el título coincidía por casualidad.
 *
 * Además, al re-añadir el libro correcto se creó una segunda saga duplicada
 * "Fae And Alchemy" (id cmtpl7z2x003w2cqfdd1f2xfa, con "And" en vez de "&"),
 * porque la comparación de nombres de saga no trataba "&"/"and" como
 * equivalentes (ya corregido en books.service.ts). Este script:
 *   1. Fusiona los dos libros "Quicksilver" (mergeBooks).
 *   2. Reasigna el libro superviviente a la saga original "Fae & Alchemy".
 *   3. Borra la saga duplicada "Fae And Alchemy" (se queda vacía).
 */

import 'dotenv/config';

import { mergeBooks } from '../src/services/book-merge.service.js';
import { prisma } from '../src/prisma.js';

const BOOK_ID_DEFINITIVO = 'cmtk5m4s200o82cqnsa56wfzb'; // Quicksilver, Callie Hart
const BOOK_ID_DUPLICADO = 'cmrd84lzc00blin5023c9moyg'; // Quicksilver, Neal Stephenson
const SERIES_ID_ORIGINAL = 'cmrd84lot001bin50tj2vkbml'; // Fae & Alchemy
const SERIES_ID_DUPLICADA = 'cmtpl7z2x003w2cqfdd1f2xfa'; // Fae And Alchemy

async function precheck() {
  const [definitivo, duplicado] = await Promise.all([
    prisma.book.findUnique({
      where: { id: BOOK_ID_DEFINITIVO },
      include: {
        author: true,
        library: { include: { user: { select: { name: true } } } },
        reviews: { include: { user: { select: { name: true } } } },
      },
    }),
    prisma.book.findUnique({
      where: { id: BOOK_ID_DUPLICADO },
      include: {
        author: true,
        library: { include: { user: { select: { name: true } } } },
        reviews: { include: { user: { select: { name: true } } } },
      },
    }),
  ]);

  if (!definitivo || definitivo.deletedAt) throw new Error(`Libro definitivo no encontrado: ${BOOK_ID_DEFINITIVO}`);
  if (!duplicado || duplicado.deletedAt) throw new Error(`Libro duplicado no encontrado: ${BOOK_ID_DUPLICADO}`);
  if (duplicado.author?.name !== 'Neal Stephenson') {
    throw new Error(`El libro duplicado no es de Neal Stephenson (es de ${duplicado.author?.name}) — aborto por seguridad`);
  }
  if (definitivo.author?.name !== 'Callie Hart') {
    throw new Error(`El libro definitivo no es de Callie Hart (es de ${definitivo.author?.name}) — aborto por seguridad`);
  }

  console.log('\n📚 LIBRO DEFINITIVO (se conserva):');
  console.log(`   "${definitivo.title}" de ${definitivo.author?.name} (${definitivo.id})`);
  console.log(`   Biblioteca: ${definitivo.library.map((l) => `${l.user.name} [${l.status}]`).join(', ') || '—'}`);

  console.log('\n📗 LIBRO DUPLICADO (se fusiona y elimina):');
  console.log(`   "${duplicado.title}" de ${duplicado.author?.name} (${duplicado.id})`);
  console.log(`   Biblioteca: ${duplicado.library.map((l) => `${l.user.name} [${l.status}]`).join(', ') || '—'}`);
}

async function main() {
  console.log('🔎 Comprobando libros antes de fusionar...');
  await precheck();

  console.log('\n🚚 Paso 1/3 — Fusionando los dos libros "Quicksilver" con mergeBooks...');
  const result = await mergeBooks(
    BOOK_ID_DUPLICADO,
    BOOK_ID_DEFINITIVO,
    'Quicksilver de Neal Stephenson estaba mal enlazado como volumen de la saga Fae & Alchemy (Callie Hart); es un libro sin relación, coincidencia de título.',
  );

  if (result.alreadyMerged) {
    console.log('\n⚠️  Los libros ya estaban fusionados. Sigo con los pasos de saga por si acaso.');
  } else {
    console.log('✅ Fusión completada.');
  }

  console.log('\n🔧 Paso 2/3 — Reasignando el libro superviviente a la saga original "Fae & Alchemy"...');
  await prisma.book.update({
    where: { id: BOOK_ID_DEFINITIVO },
    data: { seriesId: SERIES_ID_ORIGINAL, seriesOrder: '1/3' },
  });
  console.log('✅ Reasignado.');

  console.log('\n🗑️  Paso 3/3 — Borrando la saga duplicada "Fae And Alchemy" (debe estar ya vacía)...');
  const restantes = await prisma.book.count({ where: { seriesId: SERIES_ID_DUPLICADA } });
  if (restantes > 0) {
    throw new Error(`La saga duplicada todavía tiene ${restantes} libro(s) — no la borro. Revisar a mano.`);
  }
  await prisma.series.delete({ where: { id: SERIES_ID_DUPLICADA } });
  console.log('✅ Saga duplicada eliminada.');

  console.log('\n📊 Estado final:');
  const final = await prisma.book.findUnique({
    where: { id: BOOK_ID_DEFINITIVO },
    include: {
      author: true,
      series: true,
      library: { include: { user: { select: { name: true } } } },
    },
  });
  if (final) {
    console.log(`   "${final.title}" de ${final.author?.name} — saga: ${final.series?.name} (vol. ${final.seriesOrder})`);
    console.log(`   Biblioteca (${final.library.length}): ${final.library.map((l) => `${l.user.name} [${l.status}]`).join(', ')}`);
  }
}

main()
  .catch((error) => {
    console.error('\n❌ Reparación fallida:');
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
