/**
 * Fusión:
 *   "La espada de la asesina. Relatos de Trono de Cristal / The Assassin's Blade..."
 *   → "La espada de la asesina (Trono de cristal, #0.1-0.5)"  ← se conserva
 *
 * Definitivo: cmsbuqi6900kr1ytssbpeehe9  (2 usuarias, 2 reseñas, 2 completions)
 * Duplicado:  cms6mfk0n00170pnxahsyvq9o  (1 usuaria,  1 reseña,  1 completion)
 */

import 'dotenv/config';
import { mergeBooks } from '../src/services/book-merge.service.js';
import { prisma } from '../src/prisma.js';

const BOOK_ID_DEFINITIVO = 'cmsbuqi6900kr1ytssbpeehe9';
const BOOK_ID_DUPLICADO  = 'cms6mfk0n00170pnxahsyvq9o';

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

  if (!definitivo || definitivo.deletedAt) throw new Error(`Libro definitivo no encontrado`);
  if (!duplicado  || duplicado.deletedAt)  throw new Error(`Libro duplicado no encontrado`);

  console.log('\n📚 DEFINITIVO (se conserva):');
  console.log(`   "${definitivo.title}"`);
  console.log(`   Biblioteca: ${definitivo.library.map(l => `${l.user.name} [${l.status}]`).join(', ') || '—'}`);
  console.log(`   Reseñas:    ${definitivo.reviews.map(r => `${r.user.name} ★${r.rating}`).join(', ') || '—'}`);
  console.log(`   Completions: ${definitivo.readingCompletions.map(c => c.user.name).join(', ') || '—'}`);

  console.log('\n📗 DUPLICADO (se absorbe):');
  console.log(`   "${duplicado.title}"`);
  console.log(`   Biblioteca: ${duplicado.library.map(l => `${l.user.name} [${l.status}]`).join(', ') || '—'}`);
  console.log(`   Reseñas:    ${duplicado.reviews.map(r => `${r.user.name} ★${r.rating}`).join(', ') || '—'}`);
  console.log(`   Completions: ${duplicado.readingCompletions.map(c => c.user.name).join(', ') || '—'}`);

  // Detectar usuarios en ambos
  const usersDefinitivo = new Set(definitivo.library.map(l => l.user.name));
  const conflictos = duplicado.library.filter(l => usersDefinitivo.has(l.user.name));
  if (conflictos.length > 0) {
    console.log(`\n⚠️  CONFLICTOS (usuario en ambos libros): ${conflictos.map(l => l.user.name).join(', ')}`);
    console.log('   El servicio mergeBooks conservará el registro del libro definitivo.');
  } else {
    console.log('\n✅ Sin conflictos de usuario.');
  }
}

async function main() {
  console.log('🔎 Comprobando libros antes de fusionar...');
  await precheck();

  console.log('\n🚚 Fusionando...');
  const result = await mergeBooks(
    BOOK_ID_DUPLICADO,
    BOOK_ID_DEFINITIVO,
    '"La espada de la asesina. Relatos de Trono de Cristal / The Assassin\'s Blade" es la misma obra que "La espada de la asesina (Trono de cristal, #0.1-0.5)"',
  );

  if (result.alreadyMerged) {
    console.log('\n⚠️  Ya estaban fusionados.'); return;
  }

  console.log('\n✅ Fusión completada');
  console.log(`   Canónico:  ${result.canonicalBookId}`);
  console.log(`   Absorbido: ${result.sourceBookId}`);

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
    console.log(`   Biblioteca (${final.library.length}): ${final.library.map(l => `${l.user.name} [${l.status}]`).join(', ')}`);
    console.log(`   Reseñas (${final.reviews.length}): ${final.reviews.map(r => `${r.user.name} ★${r.rating}`).join(', ')}`);
    console.log(`   Completions (${final.readingCompletions.length}): ${final.readingCompletions.map(c => c.user.name).join(', ')}`);
  }

  const redirect = await prisma.bookRedirect.findUnique({ where: { oldBookId: BOOK_ID_DUPLICADO } });
  console.log(`\n🔀 Redirect: ${redirect ? '✓' : '✗'}`);
}

main()
  .catch((e) => { console.error('\n❌ Error:', e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
