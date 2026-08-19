/**
 * Script: Merge + soft-delete del libro duplicado "The Crimson Moth (The Crimson Moth, #1)"
 * al canónico "Heartless Hunter".
 *
 * Migra: library, readingCompletions, reviews → canónico
 * Luego: deletedAt + BookRedirect
 */

import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL no está definida.');

const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

const DUPLICATE_ID  = 'cmszztg0g00be2cpcumtfso45'; // The Crimson Moth (The Crimson Moth, #1)
const CANONICAL_ID  = 'cmrd84lv30073in507h8hccv0'; // Heartless Hunter

async function main() {
  // Verificar ambos libros
  const [dup, canonical] = await Promise.all([
    prisma.book.findUnique({ where: { id: DUPLICATE_ID }, select: { id: true, title: true, deletedAt: true } }),
    prisma.book.findUnique({ where: { id: CANONICAL_ID }, select: { id: true, title: true } }),
  ]);

  if (!dup)       { console.log('⚠️  Duplicado no encontrado (ya borrado?). Nada que hacer.'); return; }
  if (!canonical) { console.error('❌ Canónico no encontrado. Abortando.'); return; }
  if (dup.deletedAt) { console.log('✅ El duplicado ya tiene deletedAt. Nada que hacer.'); return; }

  console.log(`\n🔀 Merge: "${dup.title}" → "${canonical.title}"\n`);

  // Ver registros a migrar
  const [libs, completions, reviews] = await Promise.all([
    prisma.library.findMany({ where: { bookId: DUPLICATE_ID }, select: { id: true, userId: true } }),
    prisma.readingCompletion.findMany({ where: { bookId: DUPLICATE_ID }, select: { id: true, userId: true } }),
    prisma.review.findMany({ where: { bookId: DUPLICATE_ID }, select: { id: true, userId: true } }),
  ]);

  console.log(`  library entries:      ${libs.length}`);
  console.log(`  readingCompletions:   ${completions.length}`);
  console.log(`  reviews:              ${reviews.length}`);
  console.log();

  await prisma.$transaction(async (tx) => {
    // 1. Migrar biblioteca — solo si el usuario no tiene ya el canónico
    for (const lib of libs) {
      const alreadyHas = await tx.library.findFirst({ where: { userId: lib.userId, bookId: CANONICAL_ID } });
      if (alreadyHas) {
        console.log(`  ⏭️  library [${lib.userId}] ya tiene el canónico → elimino el duplicado`);
        await tx.library.delete({ where: { id: lib.id } });
      } else {
        console.log(`  📚 library [${lib.userId}] → movido al canónico`);
        await tx.library.update({ where: { id: lib.id }, data: { bookId: CANONICAL_ID } });
      }
    }

    // 2. Migrar completions
    for (const c of completions) {
      const alreadyHas = await tx.readingCompletion.findFirst({ where: { userId: c.userId, bookId: CANONICAL_ID } });
      if (alreadyHas) {
        console.log(`  ⏭️  readingCompletion [${c.userId}] ya existe en canónico → elimino duplicado`);
        await tx.readingCompletion.delete({ where: { id: c.id } });
      } else {
        console.log(`  ✅ readingCompletion [${c.userId}] → movido al canónico`);
        await tx.readingCompletion.update({ where: { id: c.id }, data: { bookId: CANONICAL_ID } });
      }
    }

    // 3. Migrar reseñas
    for (const r of reviews) {
      const alreadyHas = await tx.review.findFirst({ where: { userId: r.userId, bookId: CANONICAL_ID } });
      if (alreadyHas) {
        console.log(`  ⏭️  review [${r.userId}] ya existe en canónico → elimino duplicado`);
        await tx.review.delete({ where: { id: r.id } });
      } else {
        console.log(`  ⭐ review [${r.userId}] → movido al canónico`);
        await tx.review.update({ where: { id: r.id }, data: { bookId: CANONICAL_ID } });
      }
    }

    // 4. Soft-delete del duplicado
    await tx.book.update({ where: { id: DUPLICATE_ID }, data: { deletedAt: new Date() } });
    console.log(`\n  🗑️  Soft-delete aplicado a [${DUPLICATE_ID}]`);

    // 5. BookRedirect para que cualquier referencia vieja apunte al canónico
    await tx.bookRedirect.upsert({
      where:  { oldBookId: DUPLICATE_ID },
      update: { canonicalBookId: CANONICAL_ID },
      create: { oldBookId: DUPLICATE_ID, canonicalBookId: CANONICAL_ID },
    });
    console.log(`  🔗 BookRedirect creado: ${DUPLICATE_ID} → ${CANONICAL_ID}`);
  });

  console.log('\n✅ Merge completado correctamente.\n');
}

main()
  .catch((err) => { console.error('❌ Error:', err); process.exit(1); })
  .finally(() => prisma.$disconnect());
