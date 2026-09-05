import { prisma } from '../src/prisma.js';

// Bug: el sync de novedades de Casa del Libro fusionó por error "Hija del cielo"
// (Rodrigo Cortés, novedad real 2026-09-03) con "La mala hija" (Pedro Martí,
// publicado 2025-04-02) por solapamiento de la palabra "hija" en el título
// (ver fix en book-identity.service.ts::findSimilarBooks). Esto le copió a
// "La mala hija" el ISBN, la fecha de publicación y el BookSource de novedad
// de "Hija del cielo". Aquí devolvemos cada dato a su libro correcto.

const LA_MALA_HIJA_ID = 'cmro0lfuu00290pmgf047vgc3';
const HIJA_DEL_CIELO_ID = 'cmto1sdkm00in2ck12tytzrte';

const LA_MALA_HIJA_ISBN = '9788423367344';
const LA_MALA_HIJA_PUBLICATION_DATE = new Date('2025-04-02T12:00:00.000Z');

const HIJA_DEL_CIELO_ISBN = '9788439747369';
const HIJA_DEL_CIELO_PUBLICATION_DATE = new Date('2026-09-03T12:00:00.000Z');

const WRONG_SOURCE = {
  source: 'Casa del Libro · Novedades ficción',
  sourceUrl: 'https://www.casadellibro.com/libro-hija-del-cielo/9788439747369/18209542',
};

async function main() {
  const [malaHija, hijaDelCielo, wrongSource] = await Promise.all([
    prisma.book.findUnique({ where: { id: LA_MALA_HIJA_ID } }),
    prisma.book.findUnique({ where: { id: HIJA_DEL_CIELO_ID } }),
    prisma.bookSource.findUnique({
      where: { source_sourceUrl: WRONG_SOURCE },
    }),
  ]);

  if (!malaHija) throw new Error('No se encuentra "La mala hija"');
  if (!hijaDelCielo) throw new Error('No se encuentra "Hija del cielo"');
  if (!wrongSource || wrongSource.bookId !== LA_MALA_HIJA_ID) {
    throw new Error('El BookSource esperado no está donde se esperaba, revisar a mano antes de continuar');
  }
  if (malaHija.isbn !== HIJA_DEL_CIELO_ISBN) {
    throw new Error(`"La mala hija" no tiene el ISBN prestado esperado (tiene ${malaHija.isbn}), revisar a mano`);
  }

  console.log('Antes:');
  console.log(`  La mala hija   → isbn=${malaHija.isbn} publicationDate=${malaHija.publicationDate?.toISOString()}`);
  console.log(`  Hija del cielo → isbn=${hijaDelCielo.isbn} publicationDate=${hijaDelCielo.publicationDate?.toISOString()}`);

  await prisma.$transaction([
    prisma.book.update({
      where: { id: LA_MALA_HIJA_ID },
      data: {
        isbn: LA_MALA_HIJA_ISBN,
        normalizedIsbn: LA_MALA_HIJA_ISBN,
        publicationDate: LA_MALA_HIJA_PUBLICATION_DATE,
        publicationYear: LA_MALA_HIJA_PUBLICATION_DATE.getFullYear(),
      },
    }),
    prisma.book.update({
      where: { id: HIJA_DEL_CIELO_ID },
      data: {
        isbn: HIJA_DEL_CIELO_ISBN,
        normalizedIsbn: HIJA_DEL_CIELO_ISBN,
        publicationDate: HIJA_DEL_CIELO_PUBLICATION_DATE,
        publicationYear: HIJA_DEL_CIELO_PUBLICATION_DATE.getFullYear(),
      },
    }),
    prisma.bookSource.update({
      where: { source_sourceUrl: WRONG_SOURCE },
      data: { bookId: HIJA_DEL_CIELO_ID, lastCheckedAt: new Date() },
    }),
  ]);

  const [malaHijaAfter, hijaDelCieloAfter] = await Promise.all([
    prisma.book.findUnique({ where: { id: LA_MALA_HIJA_ID } }),
    prisma.book.findUnique({ where: { id: HIJA_DEL_CIELO_ID } }),
  ]);

  console.log('\nDespués:');
  console.log(`  La mala hija   → isbn=${malaHijaAfter?.isbn} publicationDate=${malaHijaAfter?.publicationDate?.toISOString()}`);
  console.log(`  Hija del cielo → isbn=${hijaDelCieloAfter?.isbn} publicationDate=${hijaDelCieloAfter?.publicationDate?.toISOString()}`);
  console.log('\n✅ Hecho.');
}

main().finally(() => prisma.$disconnect());
