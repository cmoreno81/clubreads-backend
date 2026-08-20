/**
 * Fusiona los dos "El vals de la bruja" de Belén Martínez
 *
 *   CANÓNICO  cms84jtb8001g0po7n62odt0h   "El vals de la bruja"  Romantasy, lib:2 comp:2 rev:2
 *   DUPLICADO cmsbuqg1h005i1ytsbwzbcpwh   "El vals de la bruja"  Fantasía,   lib:1 comp:1 rev:1
 */

import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma  = new PrismaClient({ adapter });

const DUPLICATE_ID = 'cmsbuqg1h005i1ytsbwzbcpwh';
const CANONICAL_ID = 'cms84jtb8001g0po7n62odt0h';

async function main() {
  const [dup, can] = await Promise.all([
    prisma.book.findUnique({ where: { id: DUPLICATE_ID }, select: { id: true, title: true, deletedAt: true } }),
    prisma.book.findUnique({ where: { id: CANONICAL_ID }, select: { id: true, title: true } }),
  ]);

  if (!dup)         { console.error('❌ Duplicado no encontrado'); process.exit(1); }
  if (dup.deletedAt){ console.log('⏭️  Duplicado ya borrado.'); return; }
  if (!can)         { console.error('❌ Canónico no encontrado');  process.exit(1); }

  console.log(`\n🔀 Fusionando:`);
  console.log(`   DUP: "${dup.title}" (${DUPLICATE_ID})`);
  console.log(`   CAN: "${can.title}" (${CANONICAL_ID})\n`);

  const [libs, completions, reviews] = await Promise.all([
    prisma.library.findMany({ where: { bookId: DUPLICATE_ID }, select: { id: true, userId: true } }),
    prisma.readingCompletion.findMany({ where: { bookId: DUPLICATE_ID }, select: { id: true, userId: true } }),
    prisma.review.findMany({ where: { bookId: DUPLICATE_ID }, select: { id: true, userId: true } }),
  ]);

  console.log(`Registros: library=${libs.length} completions=${completions.length} reviews=${reviews.length}\n`);

  await prisma.$transaction(async (tx) => {
    for (const lib of libs) {
      const existing = await tx.library.findFirst({ where: { userId: lib.userId, bookId: CANONICAL_ID } });
      if (existing) {
        await tx.library.delete({ where: { id: lib.id } });
        console.log(`  📚 library [${lib.userId}]: ya existe → eliminado`);
      } else {
        await tx.library.update({ where: { id: lib.id }, data: { bookId: CANONICAL_ID } });
        console.log(`  📚 library [${lib.userId}]: movido`);
      }
    }
    for (const c of completions) {
      const existing = await tx.readingCompletion.findFirst({ where: { userId: c.userId, bookId: CANONICAL_ID } });
      if (existing) {
        await tx.readingCompletion.delete({ where: { id: c.id } });
        console.log(`  ✅ completion [${c.userId}]: ya existe → eliminado`);
      } else {
        await tx.readingCompletion.update({ where: { id: c.id }, data: { bookId: CANONICAL_ID } });
        console.log(`  ✅ completion [${c.userId}]: movido`);
      }
    }
    for (const r of reviews) {
      const existing = await tx.review.findFirst({ where: { userId: r.userId, bookId: CANONICAL_ID } });
      if (existing) {
        await tx.review.delete({ where: { id: r.id } });
        console.log(`  ⭐ review [${r.userId}]: ya existe → eliminado`);
      } else {
        await tx.review.update({ where: { id: r.id }, data: { bookId: CANONICAL_ID } });
        console.log(`  ⭐ review [${r.userId}]: movido`);
      }
    }

    await tx.book.update({ where: { id: DUPLICATE_ID }, data: { deletedAt: new Date() } });
    await tx.bookRedirect.upsert({
      where:  { oldBookId: DUPLICATE_ID },
      update: { canonicalBookId: CANONICAL_ID },
      create: { oldBookId: DUPLICATE_ID, canonicalBookId: CANONICAL_ID },
    });
    console.log('\n  🗑️  Soft-delete + BookRedirect creados');
  });

  console.log('\n✅ Merge completado.\n');
}

main()
  .catch((e) => { console.error('❌', e); process.exit(1); })
  .finally(() => prisma.$disconnect());
