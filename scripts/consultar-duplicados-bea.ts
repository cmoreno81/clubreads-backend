/**
 * Consulta los libros duplicados tras la importación de Goodreads de Bea.
 * Busca: Finale, Alas de hierro / Iron Flame, Crimson Moth / Heartless Hunter
 */

import 'dotenv/config';
import { prisma } from '../src/prisma.js';

async function buscar(titulo: string) {
  return prisma.book.findMany({
    where: { title: { contains: titulo, mode: 'insensitive' }, deletedAt: null },
    include: {
      series: true,
      genre: true,
      library: { include: { user: { select: { name: true } } } },
      reviews: { include: { user: { select: { name: true } } } },
      readingCompletions: { include: { user: { select: { name: true } } } },
    },
    orderBy: { createdAt: 'asc' },
  });
}

function mostrar(libros: Awaited<ReturnType<typeof buscar>>) {
  for (const b of libros) {
    console.log(`  id:     ${b.id}`);
    console.log(`  título: ${b.title}`);
    console.log(`  saga:   ${b.series?.title ?? '—'} #${b.seriesOrder ?? '—'}`);
    console.log(`  género: ${b.genre.name}`);
    console.log(`  creado: ${b.createdAt.toISOString().slice(0, 10)}`);
    console.log(`  bib:    ${b.library.map(l => `${l.user.name}[${l.status}]`).join(', ') || '—'}`);
    console.log(`  reseñas: ${b.reviews.map(r => `${r.user.name}★${r.rating}`).join(', ') || '—'}`);
    console.log(`  compl.: ${b.readingCompletions.map(c => c.user.name).join(', ') || '—'}`);
    console.log('');
  }
}

async function main() {
  const finales = await buscar('Finale');
  console.log(`\n${'='.repeat(60)}\nFINALE (${finales.length} encontrados)\n${'='.repeat(60)}`);
  mostrar(finales);

  const alas = [
    ...await buscar('Alas de hierro'),
    ...await buscar('Iron Flame'),
  ];
  // deduplicar por id
  const alasUniq = [...new Map(alas.map(b => [b.id, b])).values()];
  console.log(`\n${'='.repeat(60)}\nALAS DE HIERRO / IRON FLAME (${alasUniq.length} encontrados)\n${'='.repeat(60)}`);
  mostrar(alasUniq);

  const crimson = [
    ...await buscar('Crimson Moth'),
    ...await buscar('Heartless Hunter'),
  ];
  const crimsonUniq = [...new Map(crimson.map(b => [b.id, b])).values()];
  console.log(`\n${'='.repeat(60)}\nCRIMSON MOTH / HEARTLESS HUNTER (${crimsonUniq.length} encontrados)\n${'='.repeat(60)}`);
  mostrar(crimsonUniq);

  // Redirects existentes
  const allIds = [...finales, ...alasUniq, ...crimsonUniq].map(b => b.id);
  const redirects = await prisma.bookRedirect.findMany({
    where: { OR: [{ oldBookId: { in: allIds } }, { canonicalBookId: { in: allIds } }] },
  });
  if (redirects.length) {
    console.log(`\n${'='.repeat(60)}\nREDIRECTS EXISTENTES\n${'='.repeat(60)}`);
    for (const r of redirects) {
      console.log(`  ${r.oldBookId} → ${r.canonicalBookId}  (${r.reason ?? ''})`);
    }
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
