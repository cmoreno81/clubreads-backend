import { prisma } from '../src/prisma.js';

async function main() {
  const user = await prisma.user.findFirst({ where: { name: 'Cristina Moreno' } });
  if (!user) throw new Error('usuaria no encontrada');

  const series = await prisma.series.findFirst({
    where: { name: 'Los Bridgerton' },
    include: { books: { where: { deletedAt: null }, select: { id: true, title: true, seriesOrder: true } } },
  });
  if (!series) throw new Error('serie no encontrada');

  const libraryRows = await prisma.library.findMany({
    where: { userId: user.id, bookId: { in: series.books.map((b) => b.id) } },
    select: { bookId: true, status: true },
  });
  const byId = new Map(libraryRows.map((r) => [r.bookId, r.status]));

  for (const b of series.books) {
    console.log(`[${b.seriesOrder}] "${b.title}" (${b.id}) → ${byId.get(b.id) ?? 'NO_ANADIDO'}`);
  }
}

main().finally(() => prisma.$disconnect());
