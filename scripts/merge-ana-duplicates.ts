/**
 * Script: Fusiona los duplicados de la importación de Ana (Bookmory 19-ago-2026)
 *
 * Par 1 — Jodido Cupido:
 *   DUPLICADO  cmszztfji009y2cpcwv5p38tn  "Jodido Cupido: Métete las flechas..." (Sin género)
 *   CANÓNICO   cms4fmi4t00b90pnz09yrl45e  "Jodido Cupido"  (Romance, con portada)
 *
 * Par 2 — Yo también no es te quiero:
 *   DUPLICADO  cmszztf5h008q2cpcqso9atqp  "YO TAMBIEN NO ES TE QUIERO" (Sin género)
 *   CANÓNICO   cms7g946i002d0po91nqurm7p  "Yo también" no es te quiero (Quererte, #1)  (Romance)
 */

import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma  = new PrismaClient({ adapter });

const PAIRS = [
  {
    label:       'Jodido Cupido',
    duplicateId: 'cmszztfji009y2cpcwv5p38tn',
    canonicalId: 'cms4fmi4t00b90pnz09yrl45e',
  },
  {
    label:       'Yo también no es te quiero',
    duplicateId: 'cmszztf5h008q2cpcqso9atqp',
    canonicalId: 'cms7g946i002d0po91nqurm7p',
  },
];

async function mergePair(duplicateId: string, canonicalId: string, label: string) {
  const [dup, can] = await Promise.all([
    prisma.book.findUnique({ where: { id: duplicateId }, select: { id: true, title: true, deletedAt: true } }),
    prisma.book.findUnique({ where: { id: canonicalId }, select: { id: true, title: true } }),
  ]);

  if (!dup || dup.deletedAt) { console.log(`  ⏭️  [${label}] Duplicado no existe o ya borrado.`); return; }
  if (!can)                  { console.error(`  ❌ [${label}] Canónico no encontrado.`); return; }

  console.log(`\n🔀 [${label}]`);
  console.log(`   DUP: "${dup.title}"`);
  console.log(`   CAN: "${can.title}"`);

  const [libs, completions, reviews] = await Promise.all([
    prisma.library.findMany({ where: { bookId: duplicateId }, select: { id: true, userId: true } }),
    prisma.readingCompletion.findMany({ where: { bookId: duplicateId }, select: { id: true, userId: true } }),
    prisma.review.findMany({ where: { bookId: duplicateId }, select: { id: true, userId: true } }),
  ]);

  await prisma.$transaction(async (tx) => {
    // library
    for (const lib of libs) {
      const has = await tx.library.findFirst({ where: { userId: lib.userId, bookId: canonicalId } });
      if (has) {
        await tx.library.delete({ where: { id: lib.id } });
        console.log(`   📚 library usuario ${lib.userId}: ya existe en canónico → eliminado del dup`);
      } else {
        await tx.library.update({ where: { id: lib.id }, data: { bookId: canonicalId } });
        console.log(`   📚 library usuario ${lib.userId}: movido al canónico`);
      }
    }

    // readingCompletions
    for (const c of completions) {
      const has = await tx.readingCompletion.findFirst({ where: { userId: c.userId, bookId: canonicalId } });
      if (has) {
        await tx.readingCompletion.delete({ where: { id: c.id } });
        console.log(`   ✅ completion usuario ${c.userId}: ya existe en canónico → eliminado`);
      } else {
        await tx.readingCompletion.update({ where: { id: c.id }, data: { bookId: canonicalId } });
        console.log(`   ✅ completion usuario ${c.userId}: movido al canónico`);
      }
    }

    // reviews
    for (const r of reviews) {
      const has = await tx.review.findFirst({ where: { userId: r.userId, bookId: canonicalId } });
      if (has) {
        await tx.review.delete({ where: { id: r.id } });
        console.log(`   ⭐ review usuario ${r.userId}: ya existe en canónico → eliminado`);
      } else {
        await tx.review.update({ where: { id: r.id }, data: { bookId: canonicalId } });
        console.log(`   ⭐ review usuario ${r.userId}: movido al canónico`);
      }
    }

    // soft-delete + redirect
    await tx.book.update({ where: { id: duplicateId }, data: { deletedAt: new Date() } });
    await tx.bookRedirect.upsert({
      where:  { oldBookId: duplicateId },
      update: { canonicalBookId: canonicalId },
      create: { oldBookId: duplicateId, canonicalBookId: canonicalId },
    });

    console.log(`   🗑️  Soft-delete + BookRedirect creados`);
  });
}

async function main() {
  for (const { label, duplicateId, canonicalId } of PAIRS) {
    await mergePair(duplicateId, canonicalId, label);
  }
  console.log('\n✅ Todos los merges completados.\n');
}

main()
  .catch((e) => { console.error('❌', e); process.exit(1); })
  .finally(() => prisma.$disconnect());
