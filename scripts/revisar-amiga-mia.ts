import { prisma } from '../src/prisma.js';

async function main() {
  const libros = await prisma.book.findMany({
    where: {
      title: {
        in: [
          'Amiga mía',
          'Amiga mia',
          'Amiga Mía',
          'Amiga Mia',
        ],
      },
    },
    include: {
      library: {
        include: {
          user: true,
        },
      },
      reviews: {
        include: {
          user: true,
        },
      },
      readings: true,
      clubvisionCandidates: true,
    },
  });

  for (const libro of libros) {
    console.log('\n------------------------------');
    console.log(`ID: ${libro.id}`);
    console.log(`Título: ${libro.title}`);
    console.log(`Portada: ${libro.coverUrl ?? ''}`);
    console.log(`Goodreads: ${libro.goodreadsUrl ?? ''}`);

    console.log(
      'Bibliotecas:',
      libro.library.map((item) => ({
        libraryId: item.id,
        usuaria: item.user.name,
        estado: item.status,
        inicio: item.startedAt,
        fin: item.finishedAt,
      })),
    );

    console.log(
      'Reseñas:',
      libro.reviews.map((review) => ({
        reviewId: review.id,
        usuaria: review.user.name,
        puntuacion: review.rating,
      })),
    );

    console.log(`Lecturas conjuntas: ${libro.readings.length}`);
    console.log(
      `Candidaturas Clubvisión: ${libro.clubvisionCandidates.length}`,
    );
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });