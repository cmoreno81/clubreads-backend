import 'dotenv/config';
import { prisma } from '../src/prisma.js';

async function main() {
  // Buscar todos los libros de Sarah J. Maas con "corte de rosas" en el título
  const books = await prisma.book.findMany({
    where: {
      title: { contains: 'corte de rosas', mode: 'insensitive' },
    },
    include: {
      author: { select: { name: true } },
      series: { select: { id: true, name: true } },
      _count: { select: { library: true, reviews: true, readingCompletions: true } },
    },
    orderBy: { createdAt: 'asc' },
  });

  for (const b of books) {
    console.log(`\n📚 "${b.title}"`);
    console.log(`   ID: ${b.id}`);
    console.log(`   Autor: ${b.author?.name ?? '—'}`);
    console.log(`   Saga: ${b.series?.name ?? '—'} (seriesId: ${b.seriesId ?? 'null'})`);
    console.log(`   coverUrl: ${b.coverUrl ?? '—'}`);
    console.log(`   deletedAt: ${b.deletedAt ?? 'null (activo)'}`);
    console.log(`   Biblioteca: ${b._count.library} | Reseñas: ${b._count.reviews} | Completions: ${b._count.readingCompletions}`);
  }

  // Ver si hay BookRedirect para alguno de ellos
  const redirects = await prisma.bookRedirect.findMany({
    where: { newBookId: { in: books.map(b => b.id) } },
  });
  if (redirects.length > 0) {
    console.log('\n🔀 Redirects encontrados:');
    for (const r of redirects) console.log(`   ${r.oldBookId} → ${r.newBookId}`);
  }
}

main().finally(() => prisma.$disconnect());
