/**
 * Fusiones tras la importación de Goodreads de Bea (2026-08-21)
 *
 * ── 1. FINALE ────────────────────────────────────────────────────────
 *  Canónico (se conserva):  cmt314rnt00dy2cufk7qh8wux  "Finale (Caraval, #3)"
 *                            Bea [FINISHED ★3]
 *  Duplicado (se absorbe):  cmt31pfcv00gs2cuf6khkylf5  "Finale"
 *                            Ana [PENDING]
 *  Correcciones de metadata: title → "Finale", saga Caraval #3, género Fantasía
 *
 * ── 2. ALAS DE HIERRO ────────────────────────────────────────────────
 *  Canónico (se conserva):  cms66gu8r00070ps8rfynd13l  "Alas de hierro (Empíreo 2)"
 *                            Marta/Cristina/Mery/Ana/Silvia/NicoFlaco
 *  Duplicado (se absorbe):  cmt314r3b00ch2cufwuumsmpt  "Alas de hierro"
 *                            Bea [FINISHED ★4]
 *  Correcciones de metadata: seriesId → Empireo
 *
 * ── 3. CRIMSON MOTH → HEARTLESS HUNTER ──────────────────────────────
 *  Canónico (se conserva):  cmrd84lv30073in507h8hccv0  "Heartless Hunter"
 *                            Cristina[PENDING], Mery/Silvia/Ana [FINISHED]
 *  Duplicado (se absorbe):  cmt314ps900812cufk5uf9ti3  "Crimson Moth"
 *                            Bea [FINISHED ★4]
 */

import 'dotenv/config';
import { mergeBooks } from '../src/services/book-merge.service.js';
import { prisma } from '../src/prisma.js';

// ── IDs ──────────────────────────────────────────────────────────────
const FINALE_CANONICO  = 'cmt314rnt00dy2cufk7qh8wux'; // Finale (Caraval, #3) — Bea
const FINALE_DUPLICADO = 'cmt31pfcv00gs2cuf6khkylf5'; // Finale — Ana

const ALAS_CANONICO  = 'cms66gu8r00070ps8rfynd13l'; // Alas de hierro (Empíreo 2) — varios
const ALAS_DUPLICADO = 'cmt314r3b00ch2cufwuumsmpt'; // Alas de hierro — Bea

const CRIMSON_CANONICO  = 'cmrd84lv30073in507h8hccv0'; // Heartless Hunter — varios
const CRIMSON_DUPLICADO = 'cmt314ps900812cufk5uf9ti3'; // Crimson Moth — Bea

// ── Metadata correcta ────────────────────────────────────────────────
const SERIE_CARAVAL  = 'cmt0h3pjx00a42co88fgvbdz1';
const SERIE_EMPIREO  = 'cmrnrui6m003u0pqm9bn9ua7u';
const GENERO_FANTASIA = 'cmrd84lnd000cin50vawf5zq1'; // Fantasía 🐉

// ── Helper: mostrar estado de un libro ──────────────────────────────
async function estadoLibro(id: string) {
  const b = await prisma.book.findUnique({
    where: { id },
    include: {
      series: true,
      genre: true,
      library: { include: { user: { select: { name: true } } } },
      reviews: { include: { user: { select: { name: true } } } },
      readingCompletions: { include: { user: { select: { name: true } } } },
    },
  });
  if (!b) return console.log('  (no encontrado)');
  console.log(`  "${b.title}" (${b.id})`);
  console.log(`  saga: ${b.series?.name ?? '—'} #${b.seriesOrder ?? '—'} | género: ${b.genre.name}`);
  console.log(`  bib:  ${b.library.map(l => `${l.user.name}[${l.status}]`).join(', ') || '—'}`);
  console.log(`  reseñas: ${b.reviews.map(r => `${r.user.name}★${r.rating}`).join(', ') || '—'}`);
  console.log(`  compl.: ${b.readingCompletions.map(c => c.user.name).join(', ') || '—'}`);
}

// ── Fusión 1: Finale ─────────────────────────────────────────────────
async function fusionarFinale() {
  console.log('\n' + '='.repeat(60));
  console.log('1. FINALE');
  console.log('='.repeat(60));

  console.log('\n📚 Canónico (se conserva):');
  await estadoLibro(FINALE_CANONICO);
  console.log('\n📗 Duplicado (se absorbe):');
  await estadoLibro(FINALE_DUPLICADO);

  console.log('\n🚚 Fusionando...');
  const result = await mergeBooks(
    FINALE_DUPLICADO,
    FINALE_CANONICO,
    'Duplicate from Goodreads import: "Finale" (Ana) = "Finale (Caraval, #3)" (Bea)',
  );

  if (result.alreadyMerged) {
    console.log('⚠️  Ya estaban fusionados.');
    return;
  }

  // Corregir metadata del canónico: título limpio, saga, género
  console.log('\n🔧 Actualizando metadata del canónico...');
  await prisma.book.update({
    where: { id: FINALE_CANONICO },
    data: {
      title:      'Finale',
      seriesId:   SERIE_CARAVAL,
      seriesOrder: '3',
      genreId:    GENERO_FANTASIA,
    },
  });
  console.log('   ✓ title → "Finale" | saga Caraval #3 | género Fantasía');

  console.log('\n✅ Estado final:');
  await estadoLibro(FINALE_CANONICO);
}

// ── Fusión 2: Alas de hierro ─────────────────────────────────────────
async function fusionarAlasDeHierro() {
  console.log('\n' + '='.repeat(60));
  console.log('2. ALAS DE HIERRO');
  console.log('='.repeat(60));

  console.log('\n📚 Canónico (se conserva):');
  await estadoLibro(ALAS_CANONICO);
  console.log('\n📗 Duplicado (se absorbe):');
  await estadoLibro(ALAS_DUPLICADO);

  console.log('\n🚚 Fusionando...');
  const result = await mergeBooks(
    ALAS_DUPLICADO,
    ALAS_CANONICO,
    'Duplicate from Goodreads import: "Alas de hierro" (Bea) = "Alas de hierro (Empíreo 2)"',
  );

  if (result.alreadyMerged) {
    console.log('⚠️  Ya estaban fusionados.');
    return;
  }

  // Corregir metadata: asignar saga Empíreo si no estaba
  const canonico = await prisma.book.findUnique({ where: { id: ALAS_CANONICO }, select: { seriesId: true, title: true } });
  if (!canonico?.seriesId) {
    console.log('\n🔧 Asignando saga Empíreo al canónico...');
    await prisma.book.update({
      where: { id: ALAS_CANONICO },
      data: { seriesId: SERIE_EMPIREO, seriesOrder: '2' },
    });
    console.log('   ✓ saga Empireo #2');
  }

  console.log('\n✅ Estado final:');
  await estadoLibro(ALAS_CANONICO);
}

// ── Fusión 3: Crimson Moth → Heartless Hunter ────────────────────────
async function fusionarCrimsonMoth() {
  console.log('\n' + '='.repeat(60));
  console.log('3. CRIMSON MOTH → HEARTLESS HUNTER');
  console.log('='.repeat(60));

  console.log('\n📚 Canónico (se conserva):');
  await estadoLibro(CRIMSON_CANONICO);
  console.log('\n📗 Duplicado (se absorbe):');
  await estadoLibro(CRIMSON_DUPLICADO);

  console.log('\n🚚 Fusionando...');
  const result = await mergeBooks(
    CRIMSON_DUPLICADO,
    CRIMSON_CANONICO,
    'Duplicate from Goodreads import: "Crimson Moth" (Bea) = "Heartless Hunter"',
  );

  if (result.alreadyMerged) {
    console.log('⚠️  Ya estaban fusionados.');
    return;
  }

  console.log('\n✅ Estado final:');
  await estadoLibro(CRIMSON_CANONICO);
}

// ── main ─────────────────────────────────────────────────────────────
async function main() {
  await fusionarFinale();
  await fusionarAlasDeHierro();
  await fusionarCrimsonMoth();

  console.log('\n' + '='.repeat(60));
  console.log('RESUMEN DE REDIRECTS CREADOS');
  console.log('='.repeat(60));
  const redirects = await prisma.bookRedirect.findMany({
    where: { oldBookId: { in: [FINALE_DUPLICADO, ALAS_DUPLICADO, CRIMSON_DUPLICADO] } },
  });
  for (const r of redirects) {
    console.log(`  ${r.oldBookId} → ${r.canonicalBookId}`);
    console.log(`  motivo: ${r.reason}`);
  }
  console.log('\n🎉 Todas las fusiones completadas.');
}

main()
  .catch((err) => {
    console.error('\n❌ Error:', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
