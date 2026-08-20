/**
 * Fusión: Crimson Moth (The Crimson Moth, #1) → Heartless Hunter
 *
 * Libro definitivo (se conserva): Heartless Hunter
 *   id: cmrd84lv30073in507h8hccv0
 *
 * Libro duplicado (se absorbe y borra):
 *   id: cmsbuqi2400jv1ytsp1kk4iva  — "Crimson Moth (The Crimson Moth, #1)"
 *
 * Estado antes de la fusión:
 *   Crimson Moth  → Ana (FINISHED 2025-12-28), Mery (FINISHED 2024-04-06)
 *   Heartless Hunter → Cristina Moreno (PENDING), Silvia (FINISHED 2025-05-25)
 *   Sin conflictos de usuario entre los dos libros.
 */

import 'dotenv/config';

import { mergeBooks } from '../src/services/book-merge.service.js';
import { prisma } from '../src/prisma.js';

const BOOK_ID_DEFINITIVO = 'cmrd84lv30073in507h8hccv0';  // Heartless Hunter
const BOOK_ID_DUPLICADO  = 'cmsbuqi2400jv1ytsp1kk4iva';  // Crimson Moth (The Crimson Moth, #1)

async function precheck() {
  const [definitivo, duplicado] = await Promise.all([
    prisma.book.findUnique({
      where: { id: BOOK_ID_DEFINITIVO },
      include: {
        library:  { include: { user: { select: { name: true } } } },
        reviews:  { include: { user: { select: { name: true } } } },
        readingCompletions: { include: { user: { select: { name: true } } } },
      },
    }),
    prisma.book.findUnique({
      where: { id: BOOK_ID_DUPLICADO },
      include: {
        library:  { include: { user: { select: { name: true } } } },
        reviews:  { include: { user: { select: { name: true } } } },
        readingCompletions: { include: { user: { select: { name: true } } } },
      },
    }),
  ]);

  if (!definitivo || definitivo.deletedAt) throw new Error(`Libro definitivo no encontrado: ${BOOK_ID_DEFINITIVO}`);
  if (!duplicado  || duplicado.deletedAt)  throw new Error(`Libro duplicado no encontrado: ${BOOK_ID_DUPLICADO}`);

  console.log('\n📚 LIBRO DEFINITIVO (se conserva):');
  console.log(`   "${definitivo.title}" (${definitivo.id})`);
  console.log(`   Biblioteca: ${definitivo.library.map(l => `${l.user.name} [${l.status}]`).join(', ') || '—'}`);
  console.log(`   Reseñas:    ${definitivo.reviews.map(r => `${r.user.name} ★${r.rating}`).join(', ') || '—'}`);
  console.log(`   Completions: ${definitivo.readingCompletions.map(c => c.user.name).join(', ') || '—'}`);

  console.log('\n📗 LIBRO DUPLICADO (se fusiona y elimina):');
  console.log(`   "${duplicado.title}" (${duplicado.id})`);
  console.log(`   Biblioteca: ${duplicado.library.map(l => `${l.user.name} [${l.status}]`).join(', ') || '—'}`);
  console.log(`   Reseñas:    ${duplicado.reviews.map(r => `${r.user.name} ★${r.rating}`).join(', ') || '—'}`);
  console.log(`   Completions: ${duplicado.readingCompletions.map(c => c.user.name).join(', ') || '—'}`);

  return { definitivo, duplicado };
}

async function main() {
  console.log('🔎 Comprobando libros antes de fusionar...');
  await precheck();

  console.log('\n🚚 Iniciando fusión con el servicio mergeBooks...');
  const result = await mergeBooks(
    BOOK_ID_DUPLICADO,   // source
    BOOK_ID_DEFINITIVO,  // canonical
    'Duplicate: Crimson Moth (The Crimson Moth, #1) is the same book as Heartless Hunter',
  );

  if (result.alreadyMerged) {
    console.log('\n⚠️  Los libros ya estaban fusionados. No se ha cambiado nada.');
    return;
  }

  console.log('\n✅ Fusión completada con éxito');
  console.log(`   Libro canónico: ${result.canonicalBookId}`);
  console.log(`   Libro absorbido: ${result.sourceBookId}`);

  // Verificar estado final
  const final = await prisma.book.findUnique({
    where: { id: BOOK_ID_DEFINITIVO },
    include: {
      library:  { include: { user: { select: { name: true } } } },
      reviews:  { include: { user: { select: { name: true } } } },
      readingCompletions: { include: { user: { select: { name: true } } } },
    },
  });

  if (final) {
    console.log('\n📊 Estado final de "Heartless Hunter":');
    console.log(`   Biblioteca (${final.library.length} usuarias): ${final.library.map(l => `${l.user.name} [${l.status}]`).join(', ')}`);
    console.log(`   Reseñas (${final.reviews.length}): ${final.reviews.map(r => `${r.user.name} ★${r.rating}`).join(', ')}`);
    console.log(`   Completions (${final.readingCompletions.length}): ${final.readingCompletions.map(c => c.user.name).join(', ')}`);
  }

  const redirect = await prisma.bookRedirect.findUnique({ where: { oldBookId: BOOK_ID_DUPLICADO } });
  console.log(`\n🔀 Redirect creado: ${redirect ? '✓' : '✗'} ${BOOK_ID_DUPLICADO} → ${BOOK_ID_DEFINITIVO}`);
}

main()
  .catch((error) => {
    console.error('\n❌ Fusión fallida:');
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
