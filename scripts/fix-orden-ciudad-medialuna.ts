/**
 * Corrige el seriesOrder de "Casa de tierra y sangre" (Ciudad Medialuna #1):
 * tenía seriesOrder=4 en vez de 1, por eso salía el último en vez del primero.
 *
 * Uso: npx tsx scripts/fix-orden-ciudad-medialuna.ts
 */
import 'dotenv/config';
import { prisma } from '../src/prisma.js';

const BOOK_ID = 'cmsbuqlcs016g1ytsl14wjcm6'; // Casa de tierra y sangre (#1)

async function main() {
  const antes = await prisma.book.findUnique({
    where: { id: BOOK_ID },
    select: { id: true, title: true, seriesOrder: true },
  });
  if (!antes) {
    console.error(`No se encontró el libro ${BOOK_ID}.`);
    return;
  }
  console.log('Antes:', antes);

  const despues = await prisma.book.update({
    where: { id: BOOK_ID },
    data: { seriesOrder: '1' },
    select: { id: true, title: true, seriesOrder: true },
  });
  console.log('✅ Después:', despues);
}

main().finally(() => prisma.$disconnect());