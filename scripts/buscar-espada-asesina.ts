import 'dotenv/config';
import { prisma } from '../src/prisma.js';

async function main() {
  const books = await prisma.book.findMany({
    where: { title: { contains: 'espada de la asesina', mode: 'insensitive' }, deletedAt: null },
    select: {
      id: true,
      title: true,
      _count: { select: { library: true, reviews: true, readingCompletions: true } },
    },
    orderBy: { createdAt: 'asc' },
  });
  console.log(JSON.stringify(books, null, 2));
}

main().finally(() => prisma.$disconnect());
