import 'dotenv/config';
import { prisma } from '../src/prisma.js';

async function main() {
  const books = await prisma.book.findMany({
    where: { title: { contains: 'corona de medianoche', mode: 'insensitive' }, deletedAt: null },
    select: { id: true, title: true, coverUrl: true, author: { select: { name: true } } },
  });
  console.log(JSON.stringify(books, null, 2));
}

main().finally(() => prisma.$disconnect());
