import { prisma } from '../src/prisma.js';

async function main() {
  const finished = await prisma.library.findMany({
    where: { status: 'FINISHED' },
    include: {
      user: true,
      book: true,
    },
    orderBy: [
      { user: { name: 'asc' } },
      { book: { title: 'asc' } },
    ],
  });

  console.log('FINISHED en Library:', finished.length);

  for (const item of finished) {
    console.log(`${item.user.name} — ${item.book.title}`);
  }
}

main()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
  });
