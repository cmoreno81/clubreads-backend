import { prisma } from '../src/prisma.js';

// Libro de prueba añadido y finalizado durante una sesión de pruebas del
// simulador (no es una lectura real de la usuaria): se retira por completo
// de su biblioteca (Library + ReadingCompletion + Review si existiera).

const USUARIO = 'Cristina Moreno';
const TITULO_LIBRO = 'Flawless';

async function main() {
  const user = await prisma.user.findFirst({ where: { name: USUARIO } });
  if (!user) throw new Error(`No se encuentra la usuaria "${USUARIO}"`);

  const book = await prisma.book.findFirst({
    where: { title: TITULO_LIBRO, deletedAt: null },
  });
  if (!book) throw new Error(`No se encuentra el libro "${TITULO_LIBRO}"`);

  const [library, completions, reviews] = await Promise.all([
    prisma.library.findUnique({
      where: { userId_bookId: { userId: user.id, bookId: book.id } },
    }),
    prisma.readingCompletion.findMany({
      where: { userId: user.id, bookId: book.id },
    }),
    prisma.review.findMany({ where: { userId: user.id, bookId: book.id } }),
  ]);

  console.log(`Libro: "${book.title}" (${book.id})`);
  console.log(`Library: ${library ? `status=${library.status}` : 'no existe'}`);
  console.log(`ReadingCompletion: ${completions.length}`);
  console.log(`Review: ${reviews.length}`);

  if (!library && completions.length === 0 && reviews.length === 0) {
    console.log('\nNada que borrar.');
    return;
  }

  await prisma.$transaction([
    prisma.review.deleteMany({ where: { userId: user.id, bookId: book.id } }),
    prisma.readingCompletion.deleteMany({
      where: { userId: user.id, bookId: book.id },
    }),
    ...(library
      ? [prisma.library.delete({ where: { id: library.id } })]
      : []),
  ]);

  console.log('\n✅ Eliminado de la biblioteca de la usuaria.');
}

main().finally(() => prisma.$disconnect());
