/**
 * Script: Fusionar duplicados "A Sir Phillip, con amor"
 *
 * DUPLICADO (portada verde, 2009, serie "Bridgerton"):
 *   cmt72ccqp00012cp5ggdyngu6
 *
 * CANÓNICO (portada amarilla, 2020, serie "Los Bridgerton"):
 *   cmsbuqmeb01d91ytsnw7bqfnt
 *
 * Además:
 * - Limpiar el título del canónico → "A Sir Phillip, con amor"
 * - Añadir "Felices para siempre" a "Los Bridgerton" (#1.5)
 * - Borrar series vacías: "Bridgerton", "Bridgetons", "Bridgetown"
 */

import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

const DB = process.env.DATABASE_URL;
if (!DB) throw new Error('DATABASE_URL no definida');

const adapter = new PrismaPg({ connectionString: DB });
const prisma = new PrismaClient({ adapter });

const DUPLICATE_ID  = 'cmt72ccqp00012cp5ggdyngu6'; // A Sir Phillip (portada verde)
const CANONICAL_ID  = 'cmsbuqmeb01d91ytsnw7bqfnt'; // A Sir Phillip (portada amarilla)
const FELICES_ID    = 'cmsbuqmbi01ct1ytsnba2ta50'; // Felices para siempre
const SERIES_CANON  = 'cmt76xpf600162cpd6y3hl1o9'; // Los Bridgerton
const SERIES_GHOST  = [
  'cmt76k8zz001r2cpbjxgr1iie', // Bridgerton (solo tenía el duplicado)
  'cmt31rmtd00h22cufyp5lk16x', // Bridgetons (vacía)
  'cmt31s4ao00h32cufm5sdjpc8', // Bridgetown (vacía, nombre erróneo)
];

async function main() {
  // ── Verificar ──────────────────────────────────────────────────────────────
  const [dup, canonical] = await Promise.all([
    prisma.book.findUnique({ where: { id: DUPLICATE_ID }, select: { id: true, title: true, deletedAt: true } }),
    prisma.book.findUnique({ where: { id: CANONICAL_ID }, select: { id: true, title: true } }),
  ]);

  if (!canonical) { console.error('❌ Canónico no encontrado.'); return; }
  if (!dup)       { console.log('⚠️  Duplicado no encontrado (¿ya borrado?).'); }

  console.log(`\n📚 Canónico: "${canonical.title}" [${CANONICAL_ID}]`);
  if (dup) console.log(`🗑️  Duplicado: "${dup.title}" [${DUPLICATE_ID}]`);

  // ── Datos a migrar del duplicado ──────────────────────────────────────────
  let libs: any[] = [], completions: any[] = [], reviews: any[] = [];
  if (dup && !dup.deletedAt) {
    [libs, completions, reviews] = await Promise.all([
      prisma.library.findMany({ where: { bookId: DUPLICATE_ID }, select: { id: true, userId: true } }),
      prisma.readingCompletion.findMany({ where: { bookId: DUPLICATE_ID }, select: { id: true, userId: true } }),
      prisma.review.findMany({ where: { bookId: DUPLICATE_ID }, select: { id: true, userId: true } }),
    ]);
    console.log(`\n  Library entries:    ${libs.length}`);
    console.log(`  ReadingCompletions: ${completions.length}`);
    console.log(`  Reviews:            ${reviews.length}`);
  }

  await prisma.$transaction(async (tx) => {
    // 1. Migrar biblioteca
    for (const lib of libs) {
      const existing = await tx.library.findFirst({ where: { userId: lib.userId, bookId: CANONICAL_ID } });
      if (existing) {
        await tx.library.delete({ where: { id: lib.id } });
        console.log(`  ⏭️  library [${lib.userId}] ya tiene el canónico → eliminado`);
      } else {
        await tx.library.update({ where: { id: lib.id }, data: { bookId: CANONICAL_ID } });
        console.log(`  📚 library [${lib.userId}] → movido al canónico`);
      }
    }

    // 2. Migrar lecturas
    for (const c of completions) {
      const existing = await tx.readingCompletion.findFirst({ where: { userId: c.userId, bookId: CANONICAL_ID } });
      if (existing) {
        await tx.readingCompletion.delete({ where: { id: c.id } });
        console.log(`  ⏭️  readingCompletion [${c.userId}] ya existe → eliminado`);
      } else {
        await tx.readingCompletion.update({ where: { id: c.id }, data: { bookId: CANONICAL_ID } });
        console.log(`  ✅ readingCompletion [${c.userId}] → movido`);
      }
    }

    // 3. Migrar reseñas
    for (const r of reviews) {
      const existing = await tx.review.findFirst({ where: { userId: r.userId, bookId: CANONICAL_ID } });
      if (existing) {
        await tx.review.delete({ where: { id: r.id } });
        console.log(`  ⏭️  review [${r.userId}] ya existe → eliminado`);
      } else {
        await tx.review.update({ where: { id: r.id }, data: { bookId: CANONICAL_ID } });
        console.log(`  ⭐ review [${r.userId}] → movido`);
      }
    }

    // 4. Soft-delete del duplicado
    if (dup && !dup.deletedAt) {
      await tx.book.update({ where: { id: DUPLICATE_ID }, data: { deletedAt: new Date() } });
      console.log(`\n  🗑️  Soft-delete del duplicado [${DUPLICATE_ID}]`);

      await tx.bookRedirect.upsert({
        where:  { oldBookId: DUPLICATE_ID },
        update: { canonicalBookId: CANONICAL_ID },
        create: { oldBookId: DUPLICATE_ID, canonicalBookId: CANONICAL_ID },
      });
      console.log(`  🔗 BookRedirect: ${DUPLICATE_ID} → ${CANONICAL_ID}`);
    }

    // 5. Limpiar título del canónico
    await tx.book.update({
      where: { id: CANONICAL_ID },
      data: { title: 'A Sir Phillip, con amor' },
    });
    console.log(`\n  ✏️  Título limpiado → "A Sir Phillip, con amor"`);

    // 6. Añadir "Felices para siempre" a "Los Bridgerton"
    await tx.book.update({
      where: { id: FELICES_ID },
      data: { seriesId: SERIES_CANON, seriesOrder: '1.5', standalone: false },
    });
    console.log(`  📖 "Felices para siempre" → "Los Bridgerton" #1.5`);

    // 7. Eliminar series vacías fantasma
    for (const sid of SERIES_GHOST) {
      const series = await tx.series.findUnique({ where: { id: sid }, select: { name: true } });
      if (!series) { console.log(`  ℹ️  Serie [${sid}] no encontrada`); continue; }
      const booksCount = await tx.book.count({ where: { seriesId: sid, deletedAt: null } });
      if (booksCount > 0) {
        console.log(`  ⚠️  Serie "${series.name}" tiene ${booksCount} libro(s) activos → no se borra`);
        continue;
      }
      await tx.series.delete({ where: { id: sid } });
      console.log(`  🧹 Serie "${series.name}" [${sid}] eliminada`);
    }
  });

  console.log('\n✅ Script completado.\n');

  // Verificación final
  const finalBooks = await prisma.book.findMany({
    where: { author: { name: { contains: 'Julia Quinn', mode: 'insensitive' } }, deletedAt: null },
    include: { series: true },
    orderBy: [{ seriesId: 'asc' }, { seriesOrder: 'asc' }],
  });
  console.log('=== Estado final ===');
  for (const b of finalBooks) {
    console.log(`  #${b.seriesOrder ?? '-'} [${b.series?.name ?? 'sin serie'}] ${b.title}`);
  }

  await prisma.$disconnect();
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
