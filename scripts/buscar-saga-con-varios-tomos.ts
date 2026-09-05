import { prisma } from '../src/prisma.js';

async function main() {
  const series = await prisma.series.findMany({
    include: {
      books: {
        where: { deletedAt: null },
        select: { id: true, title: true, seriesOrder: true },
      },
    },
  });
  const conVarios = series
    .filter((s) => s.books.length >= 2)
    .sort((a, b) => b.books.length - a.books.length)
    .slice(0, 5);

  for (const s of conVarios) {
    console.log(`\n🔗 "${s.name}" — ${s.books.length} tomos en catálogo`);
    for (const b of s.books) {
      console.log(`   - [${b.seriesOrder ?? '?'}] "${b.title}" (${b.id})`);
    }
  }
}

main().finally(() => prisma.$disconnect());
