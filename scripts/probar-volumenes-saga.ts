import { getSeriesVolumesForBook } from '../src/services/series-volumes.service.js';
import { prisma } from '../src/prisma.js';

async function main() {
  const book = await prisma.book.findFirst({
    where: { title: { contains: 'duque y yo', mode: 'insensitive' } },
  });
  if (!book) throw new Error('libro no encontrado');

  const resultado = await getSeriesVolumesForBook(book.id, 'Cristina Moreno');
  console.log(JSON.stringify(resultado, null, 2));
}

main().finally(() => prisma.$disconnect());
