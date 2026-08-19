/**
 * Script: Fusiona duplicados Captive de la importación Bookmory de Ana
 *
 * Par 1:
 *   DUPLICADO  cmszztdou004p2cpcgrvdh9r6  "Captive 3: Moriría por ti"  Sin género, sin portada
 *   CANÓNICO   cmszuqosv000r2cpclke1qkws  "Captive: Moriría por ti"    Juvenile Fiction, con portada
 *
 * Par 2:
 *   DUPLICADO  cmszztdne004k2cpc7cewhes4  "Captive"                     Sin género, sin portada
 *   CANÓNICO   cmszufjed00022cpcj7ywl2ju  "Captive: No juegues conmigo" Dark Romance, con portada
 */

import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma  = new PrismaClient({ adapter });

const PAIRS = [
  {
    label:       'Captive 3: Moriría por ti',
    duplicateId: 'cmszztdou004p2cpcgrvdh9r6',
    canonicalId: 'cmszuqosv000r2cpclke1qkws',
  },
  {
    label:       'Captive (solo)',
    duplicateId: 'cmszztdne004k2cpc7cewhes4',
    canonicalId: 'cmszufjed00022cpcj7ywl2ju',
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

  console.log(`   library: ${libs.length}, completions: ${completions.length}, reviews: ${reviews.length}`);

  await prisma.$transaction(async (tx) => {
    for (const lib of libs) {
      const has = await tx.library.findFirst({ where: { userId: lib.userId, bookId: canonicalId } });
      if (has) {
        await tx.library.delete({ where: { id: lib.id } });
        console.log(`   📚 library ${lib.userId}: ya existe en canónico → eliminado`);
      } else {
        await tx.library.update({ where: { id: lib.id }, data: { bookId: canonicalId } });
        console.log(`   📚 library ${lib.userId}: movido al canónico`);
      }
    }

    for (const c of completions) {
      const has = await tx.readingCompletion.findFirst({ where: { userId: c.userId, bookId: canonicalId } });
      if (has) {
        await tx.readingCompletion.delete({ where: { id: c.id } });
        console.log(`   ✅ completion ${c.userId}: ya existe en canónico → eliminado`);
      } else {
        await tx.readingCompletion.update({ where: { id: c.id }, data: { bookId: canonicalId } });
        console.log(`   ✅ completion ${c.userId}: movido al canónico`);
      }
    }

    for (const r of reviews) {
      const has = await tx.review.findFirst({ where: { userId: r.userId, bookId: canonicalId } });
      if (has) {
        await tx.review.delete({ where: { id: r.id } });
        console.log(`   ⭐ review ${r.userId}: ya existe en canónico → eliminado`);
      } else {
        await tx.review.update({ where: { id: r.id }, data: { bookId: canonicalId } });
        console.log(`   ⭐ review ${r.userId}: movido al canónico`);
      }
    }

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
