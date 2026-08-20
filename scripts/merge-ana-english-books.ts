/**
 * Elimina libros en inglés importados por Ana (anafdezc@gmail.com)
 *
 * Pares con equivalente español → se migran los registros de Ana al libro español:
 *   "Bride (Bride, #1)"         cmt0gvj4r00362co8ol7jujeh → "Novia"  cms6notv700230pnx47o0n69u
 *   "Mate (Bride, #2)"          cmt0gviur00282co8m5u1y95x → "Alfa"   cmrd84lnl000iin508ge1qzpq
 *
 * Sin equivalente español → se eliminan directamente (solo Ana los tenía):
 *   "Chute (Elantris, #1, Part 1)"         cmt0gvit400232co8o5tr7601
 *   "The Crimson Moth (The Crimson Moth, #1)" cmt0gvira001y2co80uwe1sp5
 */

import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma  = new PrismaClient({ adapter });

const MERGES = [
  {
    label:       'Bride → Novia',
    duplicateId: 'cmt0gvj4r00362co8ol7jujeh',
    canonicalId: 'cms6notv700230pnx47o0n69u',
  },
  {
    label:       'Mate → Alfa',
    duplicateId: 'cmt0gviur00282co8m5u1y95x',
    canonicalId: 'cmrd84lnl000iin508ge1qzpq',
  },
];

const DELETE_ONLY = [
  { id: 'cmt0gvit400232co8o5tr7601', label: 'Chute (Elantris, #1, Part 1)' },
  { id: 'cmt0gvira001y2co80uwe1sp5', label: 'The Crimson Moth' },
];

// ── Helpers ────────────────────────────────────────────────────────────────

async function migrateRecords(
  tx: Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>,
  dupId: string,
  canId: string,
) {
  const [libs, completions, reviews] = await Promise.all([
    tx.library.findMany({ where: { bookId: dupId }, select: { id: true, userId: true } }),
    tx.readingCompletion.findMany({ where: { bookId: dupId }, select: { id: true, userId: true } }),
    tx.review.findMany({ where: { bookId: dupId }, select: { id: true, userId: true } }),
  ]);

  for (const lib of libs) {
    const has = await tx.library.findFirst({ where: { userId: lib.userId, bookId: canId } });
    if (has) {
      await tx.library.delete({ where: { id: lib.id } });
      console.log(`   📚 library [${lib.userId}]: ya existe → eliminado`);
    } else {
      await tx.library.update({ where: { id: lib.id }, data: { bookId: canId } });
      console.log(`   📚 library [${lib.userId}]: movido`);
    }
  }

  for (const c of completions) {
    const has = await tx.readingCompletion.findFirst({ where: { userId: c.userId, bookId: canId } });
    if (has) {
      await tx.readingCompletion.delete({ where: { id: c.id } });
      console.log(`   ✅ completion [${c.userId}]: ya existe → eliminado`);
    } else {
      await tx.readingCompletion.update({ where: { id: c.id }, data: { bookId: canId } });
      console.log(`   ✅ completion [${c.userId}]: movido`);
    }
  }

  for (const r of reviews) {
    const has = await tx.review.findFirst({ where: { userId: r.userId, bookId: canId } });
    if (has) {
      await tx.review.delete({ where: { id: r.id } });
      console.log(`   ⭐ review [${r.userId}]: ya existe → eliminado`);
    } else {
      await tx.review.update({ where: { id: r.id }, data: { bookId: canId } });
      console.log(`   ⭐ review [${r.userId}]: movido`);
    }
  }
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  // 1. Merges con equivalente español
  for (const { label, duplicateId, canonicalId } of MERGES) {
    const [dup, can] = await Promise.all([
      prisma.book.findUnique({ where: { id: duplicateId }, select: { title: true, deletedAt: true } }),
      prisma.book.findUnique({ where: { id: canonicalId }, select: { title: true } }),
    ]);
    if (!dup || dup.deletedAt) { console.log(`⏭️  [${label}] ya borrado`); continue; }

    console.log(`\n🔀 [${label}]`);
    console.log(`   DUP: "${dup.title}"`);
    console.log(`   CAN: "${can?.title}"`);

    await prisma.$transaction(async (tx) => {
      await migrateRecords(tx as any, duplicateId, canonicalId);
      await tx.book.update({ where: { id: duplicateId }, data: { deletedAt: new Date() } });
      await tx.bookRedirect.upsert({
        where:  { oldBookId: duplicateId },
        update: { canonicalBookId: canonicalId },
        create: { oldBookId: duplicateId, canonicalBookId: canonicalId },
      });
      console.log(`   🗑️  Soft-delete + BookRedirect`);
    });
  }

  // 2. Eliminar directamente (sin equivalente español)
  for (const { id, label } of DELETE_ONLY) {
    const book = await prisma.book.findUnique({ where: { id }, select: { title: true, deletedAt: true } });
    if (!book || book.deletedAt) { console.log(`⏭️  [${label}] ya borrado`); continue; }

    console.log(`\n🗑️  [${label}] — eliminando sin migrar`);

    await prisma.$transaction(async (tx) => {
      // Borrar todos los registros asociados (solo Ana los tenía)
      await tx.library.deleteMany({ where: { bookId: id } });
      await tx.readingCompletion.deleteMany({ where: { bookId: id } });
      await tx.review.deleteMany({ where: { bookId: id } });
      await tx.book.update({ where: { id }, data: { deletedAt: new Date() } });
      console.log(`   ✅ Registros de Ana eliminados + soft-delete`);
    });
  }

  console.log('\n✅ Limpieza completada.\n');
}

main()
  .catch((e) => { console.error('❌', e); process.exit(1); })
  .finally(() => prisma.$disconnect());
