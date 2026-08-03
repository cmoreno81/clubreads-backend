import { prisma } from '../src/prisma.js';
import { updateSeriesPublicationStatus } from '../src/services/catalog.service.js';

async function ensureUser(name: string) {
  return prisma.user.upsert({
    where: { name },
    update: {},
    create: { name, email: `${name.toLowerCase()}@test.local` },
  });
}

async function ensureGenre() {
  return prisma.genre.upsert({
    where: { name: 'TestGenre' },
    update: {},
    create: { name: 'TestGenre' },
  });
}

async function createSeriesWithBooks(count: number, genreId: string) {
  const series = await prisma.series.create({
    data: { name: `Test Series ${count} - ${Date.now()}`, genreId },
  });

  for (let i = 1; i <= count; i++) {
    await prisma.book.create({
      data: {
        title: `Test Book ${i} of series ${series.id}`,
        genreId,
        seriesId: series.id,
        standalone: false,
      },
    });
  }
  // reload with books
  return prisma.series.findUnique({ where: { id: series.id }, include: { books: true } });
}

async function run() {
  const user = await ensureUser('Cristina');
  const genre = await ensureGenre();

  const cases = [2, 3, 4, 5];
  for (const n of cases) {
    const series = await createSeriesWithBooks(n, genre.id);
    if (!series) {
      console.error('Failed to create series for', n);
      continue;
    }

    console.log(`\nTesting series ${series.id} with ${n} books — setting totalPrevisto=${n}`);
    const result = await updateSeriesPublicationStatus(user.name, {
      sagaId: series.id,
      estadoEditorial: 'COMPLETED',
      totalPrevisto: n,
    });
    console.log('Result:', result);
  }

  await prisma.$disconnect();
}

run().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
