import { prisma } from '../src/prisma.js';

async function main() {
  const books = await prisma.book.findMany({
    where: { title: { contains: 'Maldici', mode: 'insensitive' } },
    include: { series: true, author: true },
  });
  for (const b of books) {
    console.log(`\n📚 "${b.title}" (${b.id})`);
    console.log(`   autor: ${b.author?.name ?? '—'}`);
    console.log(`   seriesId: ${b.seriesId ?? 'null'}`);
    console.log(`   series: ${b.series?.name ?? '—'} (seriesOrder=${b.seriesOrder ?? '—'})`);
    console.log(`   deletedAt: ${b.deletedAt ?? 'activo'}`);
  }

  const series = await prisma.series.findFirst({
    where: { name: { contains: 'Coven', mode: 'insensitive' } },
    include: { books: { select: { id: true, title: true, seriesOrder: true, deletedAt: true } } },
  });
  if (!series) {
    console.log('\nNo se encuentra ninguna Series "Coven of Bones"');
    return;
  }
  console.log(`\n🔗 Series: "${series.name}" (${series.id})`);
  for (const b of series.books) {
    console.log(`   - [${b.seriesOrder ?? '?'}] "${b.title}" (${b.id}) deletedAt=${b.deletedAt ?? 'activo'}`);
  }
}

main().finally(() => prisma.$disconnect());
