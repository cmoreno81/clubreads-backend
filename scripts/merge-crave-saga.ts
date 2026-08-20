/**
 * Fusiona saga Crave (inglés) → Anhelo (español)
 *
 *   "Crave (Crave, #1)"   cmt0gvkqi007o2co8qy51kqsk → "Anhelo (Anhelo, #1)"  cmsbuqloc018o1yts85a4hxuf
 *   "Crush (Crave, #2)"   cmt0gvkos007j2co85cj1uvwb → "Furia (Anhelo, #2)"   cmsbuqlmy018g1yts0sgbq0sf
 *   "Covet (Crave, #3)"   cmt0gvlel009p2co8f59dtsxn → "Ansia (Anhelo, #3)"   cmsbuqko1011x1ytsn1yviyq8
 *   "Court (Crave, #4)"   cmt0gvl9c009k2co860lm6esz → "Fulgor (Anhelo, #4)"  cmsbuqkou01211ytsptag2wq4
 */

import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma  = new PrismaClient({ adapter });

const PAIRS = [
  { label: 'Crave → Anhelo',  duplicateId: 'cmt0gvkqi007o2co8qy51kqsk', canonicalId: 'cmsbuqloc018o1yts85a4hxuf' },
  { label: 'Crush → Furia',   duplicateId: 'cmt0gvkos007j2co85cj1uvwb', canonicalId: 'cmsbuqlmy018g1yts0sgbq0sf' },
  { label: 'Covet → Ansia',   duplicateId: 'cmt0gvlel009p2co8f59dtsxn', canonicalId: 'cmsbuqko1011x1ytsn1yviyq8' },
  { label: 'Court → Fulgor',  duplicateId: 'cmt0gvl9c009k2co860lm6esz', canonicalId: 'cmsbuqkou01211ytsptag2wq4' },
];

async function mergePair(duplicateId: string, canonicalId: string, label: string) {
  const [dup, can] = await Promise.all([
    prisma.book.findUnique({ where: { id: duplicateId }, select: { title: true, deletedAt: true } }),
    prisma.book.findUnique({ where: { id: canonicalId }, select: { title: true } }),
  ]);
  if (!dup || dup.deletedAt) { console.log(`⏭️  [${label}] ya borrado`); return; }

  console.log(`\n🔀 [${label}]  "${dup.title}" → "${can?.title}"`);

  await prisma.$transaction(async (tx) => {
    const [libs, comps, revs] = await Promise.all([
      tx.library.findMany({ where: { bookId: duplicateId }, select: { id: true, userId: true } }),
      tx.readingCompletion.findMany({ where: { bookId: duplicateId }, select: { id: true, userId: true } }),
      tx.review.findMany({ where: { bookId: duplicateId }, select: { id: true, userId: true } }),
    ]);

    for (const l of libs) {
      const has = await tx.library.findFirst({ where: { userId: l.userId, bookId: canonicalId } });
      if (has) { await tx.library.delete({ where: { id: l.id } }); console.log(`  📚 [${l.userId}] ya existe → eliminado`); }
      else      { await tx.library.update({ where: { id: l.id }, data: { bookId: canonicalId } }); console.log(`  📚 [${l.userId}] movido`); }
    }
    for (const c of comps) {
      const has = await tx.readingCompletion.findFirst({ where: { userId: c.userId, bookId: canonicalId } });
      if (has) { await tx.readingCompletion.delete({ where: { id: c.id } }); console.log(`  ✅ [${c.userId}] ya existe → eliminado`); }
      else      { await tx.readingCompletion.update({ where: { id: c.id }, data: { bookId: canonicalId } }); console.log(`  ✅ [${c.userId}] movido`); }
    }
    for (const r of revs) {
      const has = await tx.review.findFirst({ where: { userId: r.userId, bookId: canonicalId } });
      if (has) { await tx.review.delete({ where: { id: r.id } }); console.log(`  ⭐ [${r.userId}] ya existe → eliminado`); }
      else      { await tx.review.update({ where: { id: r.id }, data: { bookId: canonicalId } }); console.log(`  ⭐ [${r.userId}] movido`); }
    }

    await tx.book.update({ where: { id: duplicateId }, data: { deletedAt: new Date() } });
    await tx.bookRedirect.upsert({
      where:  { oldBookId: duplicateId },
      update: { canonicalBookId: canonicalId },
      create: { oldBookId: duplicateId, canonicalBookId: canonicalId },
    });
    console.log(`  🗑️  Soft-delete + BookRedirect`);
  });
}

async function main() {
  for (const { label, duplicateId, canonicalId } of PAIRS) {
    await mergePair(duplicateId, canonicalId, label);
  }
  console.log('\n✅ Saga Crave/Anhelo fusionada.\n');
}

main()
  .catch((e) => { console.error('❌', e); process.exit(1); })
  .finally(() => prisma.$disconnect());
