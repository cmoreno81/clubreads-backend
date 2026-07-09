import { prisma } from '../src/prisma.js';

async function main() {
  const [
    users,
    genres,
    series,
    books,
    library,
    finishedLibrary,
    reviews,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.genre.count(),
    prisma.series.count(),
    prisma.book.count(),
    prisma.library.count(),
    prisma.library.count({ where: { status: 'FINISHED' } }),
    prisma.review.count(),
  ]);

  console.table({
    User: users,
    Genre: genres,
    Series: series,
    Book: books,
    Library: library,
    'Library FINISHED': finishedLibrary,
    Review: reviews,
  });

  const usersWithoutEmail = await prisma.user.findMany({
    where: { email: '' },
  });

  const booksWithoutGenre = await prisma.book.count({
    where: {
      genreId: {
        equals: '',
      },
    },
  });

  const duplicateBookTitles = await prisma.book.groupBy({
    by: ['title'],
    _count: { title: true },
    having: {
      title: {
        _count: {
          gt: 1,
        },
      },
    },
  });

  console.log('Usuarios sin email:', usersWithoutEmail.length);
  console.log('Libros sin género:', booksWithoutGenre);
  console.log('Títulos duplicados:', duplicateBookTitles.length);
}

main()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
  });
