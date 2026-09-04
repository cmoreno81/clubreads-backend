/**
 * Fusión + renombrado:
 *   "A Court of Splintered Harmony (ACOTAR, 6)"  →  absorbido por
 *   "Una corte de rosas y espinas 6"              →  renombrado a
 *   "Una corte de armonía rota"
 *
 * Libro definitivo: "Una corte de rosas y espinas 6"
 *   id: cmt75z17x00262cqnh8t921ay  — 3 usuarias en biblioteca
 *
 * Libro duplicado:  "A Court of Splintered Harmony (ACOTAR, 6)"
 *   id: cmt75yyl300002cqnnd2mid2n  — 0 usuarias
 */

import 'dotenv/config';
import { mergeBooks } from '../src/services/book-merge.service.js';
import { prisma } from '../src/prisma.js';

const BOOK_ID_DEFINITIVO = 'cmt75z17x00262cqnh8t921ay'; // Una corte de rosas y espinas 6
const BOOK_ID_DUPLICADO  = 'cmt75yyl300002cqnnd2mid2n'; // A Court of Splintered Harmony
const TITULO_FINAL       = 'Una corte de armonía rota';

async function precheck() {
  const [definitivo, duplicado] = await Promise.all([
    prisma.book.findUnique({
      where: { id: BOOK_ID_DEFINITIVO },
      include: {
        library:            { include: { user: { select: { name: true } } } },
        reviews:            { include: { user: { select: { name: true } } } },
        readingCompletions: { include: { user: { select: { name: true } } } },
      },
    }),
    prisma.book.findUnique({
      where: { id: BOOK_ID_DUPLICADO },
      include: {
        library:            { include: { user: { select: { name: true } } } },
        reviews:            { include: { user: { select: { name: true } } } },
        readingCompletions: { include: { user: { select: { name: true } } } },
      },
    }),
  ]);

  if (!definitivo || definitivo.deletedAt) throw new Error(`Libro definitivo no encontrado: ${BOOK_ID_DEFINITIVO}`);
  if (!duplicado  || duplicado.deletedAt)  throw new Error(`Libro duplicado no encontrado: ${BOOK_ID_DUPLICADO}`);

  console.log('\n📚 LIBRO DEFINITIVO (se conserva y renombra):');
  console.log(`   "${definitivo.title}" (${definitivo.id})`);
  console.log(`   Biblioteca: ${definitivo.library.map(l => `${l.user.name} [${l.status}]`).join(', ') || '—'}`);
  console.log(`   Reseñas:    ${definitivo.reviews.map(r => `${r.user.name} ★${r.rating}`).join(', ') || '—'}`);
  console.log(`   Completions: ${definitivo.readingCompletions.map(c => c.user.name).join(', ') || '—'}`);

  console.log('\n📗 LIBRO DUPLICADO (se absorbe y elimina):');
  console.log(`   "${duplicado.title}" (${duplicado.id})`);
  console.log(`   Biblioteca: ${duplicado.library.map(l => `${l.user.name} [${l.status}]`).join(', ') || '—'}`);
  console.log(`   Reseñas:    ${duplicado.reviews.map(r => `${r.user.name} ★${r.rating}`).join(', ') || '—'}`);
  console.log(`   Completions: ${duplicado.readingCompletions.map(c => c.user.name).join(', ') || '—'}`);
}

async function main() {
  console.log('🔎 Comprobando libros antes de fusionar...');
  await precheck();

  console.log('\n🚚 Fusionando libros...');
  const result = await mergeBooks(
    BOOK_ID_DUPLICADO,
    BOOK_ID_DEFINITIVO,
    '"A Court of Splintered Harmony" es la edición en inglés del mismo libro que "Una corte de rosas y espinas 6"',
  );

  if (result.alreadyMerged) {
    console.log('\n⚠️  Los libros ya estaban fusionados.');
  } else {
    console.log('\n✅ Fusión completada');
    console.log(`   Canónico:  ${result.canonicalBookId}`);
    console.log(`   Absorbido: ${result.sourceBookId}`);
  }

  console.log(`\n✏️  Renombrando a "${TITULO_FINAL}"...`);
  await prisma.book.update({
    where: { id: BOOK_ID_DEFINITIVO },
    data: { title: TITULO_FINAL },
  });

  const final = await prisma.book.findUnique({
    where: { id: BOOK_ID_DEFINITIVO },
    include: {
      library:            { include: { user: { select: { name: true } } } },
      reviews:            { include: { user: { select: { name: true } } } },
      readingCompletions: { include: { user: { select: { name: true } } } },
    },
  });

  if (final) {
    console.log('\n📊 Estado final:');
    console.log(`   Título: "${final.title}"`);
    console.log(`   Biblioteca (${final.library.length}): ${final.library.map(l => `${l.user.name} [${l.status}]`).join(', ') || '—'}`);
    console.log(`   Reseñas (${final.reviews.length}): ${final.reviews.map(r => `${r.user.name} ★${r.rating}`).join(', ') || '—'}`);
    console.log(`   Completions (${final.readingCompletions.length}): ${final.readingCompletions.map(c => c.user.name).join(', ') || '—'}`);
  }

  const redirect = await prisma.bookRedirect.findUnique({ where: { oldBookId: BOOK_ID_DUPLICADO } });
  console.log(`\n🔀 Redirect: ${redirect ? '✓' : '✗'} ${BOOK_ID_DUPLICADO} → ${BOOK_ID_DEFINITIVO}`);
}

main()
  .catch((error) => {
    console.error('\n❌ Error:');
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
