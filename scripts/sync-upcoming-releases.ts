import 'dotenv/config';
import {
  fetchUpcomingSource,
  saveUpcomingBooks,
} from '../src/services/upcoming-release-sync.service.js';
import { prisma } from '../src/prisma.js';

const sources = [
  {
    name: 'FNAC España',
    url:
      process.env.UPCOMING_FNAC_URL ??
      'https://www.fnac.es/s129487/Proximos-lanzamientos-en-libros',
  },
  ...(process.env.UPCOMING_CASA_DEL_LIBRO_URL
    ? [{ name: 'Casa del Libro', url: process.env.UPCOMING_CASA_DEL_LIBRO_URL }]
    : []),
];

try {
  const settled = await Promise.allSettled(
    sources.map((source) => fetchUpcomingSource(source.name, source.url)),
  );
  const books = settled.flatMap((result) =>
    result.status === 'fulfilled' ? result.value : [],
  );
  for (const result of settled) {
    if (result.status === 'rejected') console.error(result.reason);
  }
  const summary = await saveUpcomingBooks(books);
  console.log(JSON.stringify(summary, null, 2));
} finally {
  await prisma.$disconnect();
}
