import 'dotenv/config';
import { prisma } from '../src/prisma.js';

async function main() {
  const books = await prisma.book.findMany({
    where: {
      OR: [
        { title: { contains: 'splintered harmony', mode: 'insensitive' } },
        { title: { contains: 'armonía rota', mode: 'insensitive' } },
        { title: { contains: 'armonia rota', mode: 'insensitive' } },
      ],
      deletedAt: null,
    },
    select: {
      id: true,
      title: true,
      _count: { select: { library: true, reviews: true, readingCompletions: true } },
    },
  });
  console.log(JSON.stringify(books, null, 2));
}

main().finally(() => prisma.$disconnect());
