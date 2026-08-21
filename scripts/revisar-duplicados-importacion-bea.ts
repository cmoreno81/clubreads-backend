/**
 * Revisión de duplicados tras la importación de Goodreads de Bea.
 *
 * Estrategia revisada:
 *  1. Cargar TODOS los libros de Bea en su biblioteca (activos).
 *  2. Para cada libro de Bea, buscar en la BD otros libros activos con
 *     título similar, mismo ISBN o mismo canonicalKey.
 *  3. Filtrar sólo matches donde el libro "otro" tiene al menos una
 *     usuaria distinta de Bea (o sea, preexistía en la BD).
 *  4. Ignorar los que ya tienen un redirect entre sí (ya fusionados).
 *  5. Reportar todo con información suficiente para decidir.
 */

import 'dotenv/config';
import { prisma } from '../src/prisma.js';

function normalizeTitle(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // quitar acentos
    .replace(/[^a-z0-9 ]/g, '')      // quitar puntuación
    .replace(/\s+/g, ' ')
    .trim();
}

/** Extrae el título "raíz" quitando sufijos de saga tipo "(Caraval, #3)" o "(Empíreo 2)" */
function rootTitle(title: string): string {
  let t = title;
  // "(Serie, #N)" o "(Serie N)" o "(Serie #N)" al final
  t = t.replace(/\s*\([^)]*[,#]\s*\d[^)]*\)\s*$/, '').trim();
  // "(Palabra Número)" al final — e.g. "(Empíreo 2)"
  t = t.replace(/\s*\(\w+\s+\d+\)\s*$/, '').trim();
  return normalizeTitle(t || title);
}

async function main() {
  const beaUser = await prisma.user.findFirst({
    where: { name: { contains: 'Bea', mode: 'insensitive' } },
    select: { id: true, name: true },
  });
  if (!beaUser) throw new Error('No se encontró el usuario Bea');
  console.log(`Usuario: ${beaUser.name} (${beaUser.id})\n`);

  // ── Biblioteca activa de Bea ──────────────────────────────────────
  const beaLibrary = await prisma.library.findMany({
    where: { userId: beaUser.id, book: { deletedAt: null } },
    include: { book: { include: { series: true, genre: true } } },
    orderBy: { book: { title: 'asc' } },
  });
  console.log(`Libros en biblioteca de Bea (activos): ${beaLibrary.length}`);

  // ── Todos los libros activos de la BD (para comparar) ─────────────
  const todosLosLibros = await prisma.book.findMany({
    where: { deletedAt: null },
    include: {
      series: true,
      genre: true,
      library: { include: { user: { select: { id: true, name: true } } } },
    },
  });

  // ── Redirects existentes para excluir pares ya fusionados ─────────
  const redirects = await prisma.bookRedirect.findMany();
  const yaFusionados = new Set<string>(); // "sourceId|canonicalId"
  for (const r of redirects) {
    yaFusionados.add(`${r.oldBookId}|${r.canonicalBookId}`);
    yaFusionados.add(`${r.canonicalBookId}|${r.oldBookId}`);
  }

  // Índice por ISBN
  const porIsbn = new Map<string, typeof todosLosLibros>();
  const porCanonicalKey = new Map<string, typeof todosLosLibros>();
  for (const libro of todosLosLibros) {
    if (libro.normalizedIsbn) {
      if (!porIsbn.has(libro.normalizedIsbn)) porIsbn.set(libro.normalizedIsbn, []);
      porIsbn.get(libro.normalizedIsbn)!.push(libro);
    }
    if (libro.canonicalKey) {
      if (!porCanonicalKey.has(libro.canonicalKey)) porCanonicalKey.set(libro.canonicalKey, []);
      porCanonicalKey.get(libro.canonicalKey)!.push(libro);
    }
  }

  // ── Buscar duplicados ─────────────────────────────────────────────
  const duplicados: Array<{
    bea: typeof beaLibrary[number];
    existentes: Array<{ libro: typeof todosLosLibros[number]; motivo: string }>;
  }> = [];

  for (const beaEntry of beaLibrary) {
    const beaBook = beaEntry.book;
    const candidatos = new Map<string, { libro: typeof todosLosLibros[number]; motivo: string }>();

    // A) ISBN
    if (beaBook.normalizedIsbn) {
      for (const m of porIsbn.get(beaBook.normalizedIsbn) ?? []) {
        if (m.id !== beaBook.id && !yaFusionados.has(`${beaBook.id}|${m.id}`)) {
          candidatos.set(m.id, { libro: m, motivo: `ISBN "${beaBook.normalizedIsbn}"` });
        }
      }
    }

    // B) canonicalKey
    if (beaBook.canonicalKey) {
      for (const m of porCanonicalKey.get(beaBook.canonicalKey) ?? []) {
        if (m.id !== beaBook.id && !yaFusionados.has(`${beaBook.id}|${m.id}`)) {
          if (candidatos.has(m.id)) {
            candidatos.get(m.id)!.motivo += ` + key "${beaBook.canonicalKey}"`;
          } else {
            candidatos.set(m.id, { libro: m, motivo: `canonicalKey "${beaBook.canonicalKey}"` });
          }
        }
      }
    }

    // C) Título normalizado raíz (solo si ≥ 5 chars para evitar falsos positivos)
    const beaRoot = rootTitle(beaBook.title);
    if (beaRoot.length >= 5) {
      for (const otro of todosLosLibros) {
        if (otro.id === beaBook.id || yaFusionados.has(`${beaBook.id}|${otro.id}`)) continue;
        if (rootTitle(otro.title) === beaRoot) {
          if (candidatos.has(otro.id)) {
            candidatos.get(otro.id)!.motivo += ` + título "${beaRoot}"`;
          } else {
            candidatos.set(otro.id, { libro: otro, motivo: `título normalizado "${beaRoot}"` });
          }
        }
      }
    }

    // Filtrar: sólo donde el existente tiene usuarias ≠ Bea
    const conOtros = [...candidatos.values()].filter(
      c => c.libro.library.some(l => l.user.id !== beaUser.id),
    );

    if (conOtros.length > 0) {
      duplicados.push({ bea: beaEntry, existentes: conOtros });
    }
  }

  // ── Informe ───────────────────────────────────────────────────────
  console.log(`\n${'='.repeat(70)}`);
  if (duplicados.length === 0) {
    console.log('✅ No se encontraron más duplicados potenciales.');
    console.log('   La biblioteca de Bea está limpia.\n');
    return;
  }

  console.log(`⚠️  ${duplicados.length} posibles duplicado(s) detectado(s):\n`);

  for (const { bea, existentes } of duplicados) {
    const b = bea.book;
    console.log(`\n📗 BEA: "${b.title}"`);
    console.log(`   id:     ${b.id}`);
    console.log(`   saga:   ${b.series?.name ?? '—'} #${b.seriesOrder ?? '—'}`);
    console.log(`   género: ${b.genre.name}`);
    console.log(`   isbn:   ${b.normalizedIsbn ?? '—'}`);
    console.log(`   status: ${bea.status}`);
    const review = await prisma.review.findFirst({ where: { bookId: b.id, userId: beaUser.id } });
    if (review) console.log(`   reseña: ★${review.rating}`);

    for (const { libro: ex, motivo } of existentes) {
      const otros = ex.library.filter(l => l.user.id !== beaUser.id);
      console.log(`\n   📚 POSIBLE DUPLICADO (por ${motivo}):`);
      console.log(`      "${ex.title}"`);
      console.log(`      id:     ${ex.id}`);
      console.log(`      saga:   ${ex.series?.name ?? '—'} #${ex.seriesOrder ?? '—'}`);
      console.log(`      género: ${ex.genre.name}`);
      console.log(`      isbn:   ${ex.normalizedIsbn ?? '—'}`);
      console.log(`      creado: ${ex.createdAt.toISOString().slice(0, 10)}`);
      console.log(`      otras lectoras: ${otros.map(l => `${l.user.name}[${l.status}]`).join(', ')}`);
    }
    console.log('\n' + '-'.repeat(70));
  }

  console.log(`\nTotal libros de Bea revisados: ${beaLibrary.length}`);
  console.log(`Duplicados potenciales:        ${duplicados.length}`);
  console.log(`Sin duplicado detectado:       ${beaLibrary.length - duplicados.length}`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
