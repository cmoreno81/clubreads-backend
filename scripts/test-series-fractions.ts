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

async function createSeriesWithFractionalBooks() {
  const genre = await ensureGenre();
  const series = await prisma.series.create({
    data: { name: `Fraction Series ${Date.now()}`, genreId: genre.id },
  });

  const b1 = await prisma.book.create({
    data: { title: `B1 ${series.id}`, genreId: genre.id, seriesId: series.id, standalone: false },
  });
  const b2 = await prisma.book.create({
    data: { title: `B2 ${series.id}`, genreId: genre.id, seriesId: series.id, standalone: false },
  });

  // set second book to position 1.5
  await prisma.book.update({ where: { id: b2.id }, data: { seriesOrder: '1.5' } });

  return prisma.series.findUnique({ where: { id: series.id }, include: { books: true } });
}

async function run() {
  const user = await ensureUser('Cristina');
  const series = await createSeriesWithFractionalBooks();
  if (!series) return;
  console.log('Series created with books:', series.books.map(b => ({ id: b.id, order: b.seriesOrder })));

  console.log('Trying totalPrevisto = 2 (should be allowed)');
  const r1 = await updateSeriesPublicationStatus(user.name, { sagaId: series.id, estadoEditorial: 'COMPLETED', totalPrevisto: 2 });
  console.log('Result:', r1);

  console.log('Trying totalPrevisto = 1 (should be rejected)');
  const r2 = await updateSeriesPublicationStatus(user.name, { sagaId: series.id, estadoEditorial: 'COMPLETED', totalPrevisto: 1 });
  console.log('Result:', r2);

  await prisma.$disconnect();
}

run().catch(async (err) => { console.error(err); await prisma.$disconnect(); process.exit(1); });
