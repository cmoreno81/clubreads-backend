/**
 * Fusiona los dos "La biblioteca de medianoche" de Matt Haig
 *
 *   DUPLICADO  cmrgfcwfb00222alqwxqhrmo1  "La biblioteca de medianoche"
 *   CANÓNICO   cmsbuqg0t005e1yts9939yso0  "La biblioteca de la medianoche (Universo de la medianoche, #1)"
 *
 * lib:2 comp:2 rev:2 en cada uno → pueden solaparse usuarios.
 * Se migran TODOS los registros sin perder ninguno.
 */

import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma  = new PrismaClient({ adapter });

const DUPLICATE_ID  = 'cmrgfcwfb00222alqwxqhrmo1';
const CANONICAL_ID  = 'cmsbuqg0t005e1yts9939yso0';

async function main() {
  const [dup, can] = await Promise.all([
    prisma.book.findUnique({ where: { id: DUPLICATE_ID }, select: { id: true, title: true, deletedAt: true } }),
    prisma.book.findUnique({ where: { id: CANONICAL_ID }, select: { id: true, title: true } }),
  ]);

  if (!dup)         { console.error('❌ Duplicado no encontrado'); process.exit(1); }
  if (dup.deletedAt){ console.log('⏭️  Duplicado ya borrado, nada que hacer.'); return; }
  if (!can)         { console.error('❌ Canónico no encontrado');  process.exit(1); }

  console.log(`\n🔀 Fusionando:`);
  console.log(`   DUP: "${dup.title}"`);
  console.log(`   CAN: "${can.title}"\n`);

  const [libs, completions, reviews] = await Promise.all([
    prisma.library.findMany({ where: { bookId: DUPLICATE_ID }, select: { id: true, userId: true } }),
    prisma.readingCompletion.findMany({ where: { bookId: DUPLICATE_ID }, select: { id: true, userId: true } }),
    prisma.review.findMany({ where: { bookId: DUPLICATE_ID }, select: { id: true, userId: true } }),
  ]);

  console.log(`Registros a migrar: library=${libs.length} completions=${completions.length} reviews=${reviews.length}\n`);

  await prisma.$transaction(async (tx) => {
    // --- Library ---
    for (const lib of libs) {
      const existing = await tx.library.findFirst({ where: { userId: lib.userId, bookId: CANONICAL_ID } });
      if (existing) {
        await tx.library.delete({ where: { id: lib.id } });
        console.log(`  📚 library [${lib.userId}]: ya existe en canónico → eliminado duplicado`);
      } else {
        await tx.library.update({ where: { id: lib.id }, data: { bookId: CANONICAL_ID } });
        console.log(`  📚 library [${lib.userId}]: movido al canónico`);
      }
    }

    // --- ReadingCompletion ---
    for (const c of completions) {
      const existing = await tx.readingCompletion.findFirst({ where: { userId: c.userId, bookId: CANONICAL_ID } });
      if (existing) {
        await tx.readingCompletion.delete({ where: { id: c.id } });
        console.log(`  ✅ completion [${c.userId}]: ya existe en canónico → eliminado duplicado`);
      } else {
        await tx.readingCompletion.update({ where: { id: c.id }, data: { bookId: CANONICAL_ID } });
        console.log(`  ✅ completion [${c.userId}]: movido al canónico`);
      }
    }

    // --- Reviews ---
    for (const r of reviews) {
      const existing = await tx.review.findFirst({ where: { userId: r.userId, bookId: CANONICAL_ID } });
      if (existing) {
        await tx.review.delete({ where: { id: r.id } });
        console.log(`  ⭐ review [${r.userId}]: ya existe en canónico → eliminado duplicado`);
      } else {
        await tx.review.update({ where: { id: r.id }, data: { bookId: CANONICAL_ID } });
        console.log(`  ⭐ review [${r.userId}]: movido al canónico`);
      }
    }

    // --- Soft-delete + redirect ---
    await tx.book.update({ where: { id: DUPLICATE_ID }, data: { deletedAt: new Date() } });
    await tx.bookRedirect.upsert({
      where:  { oldBookId: DUPLICATE_ID },
      update: { canonicalBookId: CANONICAL_ID },
      create: { oldBookId: DUPLICATE_ID, canonicalBookId: CANONICAL_ID },
    });

    console.log('\n  🗑️  Soft-delete aplicado + BookRedirect creado');
  });

  console.log('\n✅ Merge completado sin pérdida de datos.\n');
}

main()
  .catch((e) => { console.error('❌', e); process.exit(1); })
  .finally(() => prisma.$disconnect());
