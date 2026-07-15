import { prisma } from '../src/prisma.js';

async function main() {
  const libros = await prisma.book.findMany({
    where: {
      title: {
        in: [
          'Todos los deseos que escribí sin ti',
          'Todos los deseos que escribí sin tí',
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
      wonClubvisions: true,
      clubvisionResults: true,
    },
  });

  if (libros.length === 0) {
    console.log('No se ha encontrado ninguno de los títulos.');
    return;
  }

  for (const libro of libros) {
    console.log('\n------------------------------');
    console.log(`ID: ${libro.id}`);
    console.log(`Título: ${libro.title}`);
    console.log(`Portada: ${libro.coverUrl ?? ''}`);
    console.log(`Goodreads: ${libro.goodreadsUrl ?? ''}`);
    console.log(`ISBN: ${libro.isbn ?? ''}`);

    console.log(
      'Bibliotecas:',
      libro.library.map((item) => ({
        libraryId: item.id,
        userId: item.userId,
        usuaria: item.user.name,
        estado: item.status,
        prioridad: item.priority,
        inicio: item.startedAt,
        fin: item.finishedAt,
      })),
    );

    console.log(
      'Reseñas:',
      libro.reviews.map((review) => ({
        reviewId: review.id,
        userId: review.userId,
        usuaria: review.user.name,
        puntuacion: review.rating,
        resena: review.review ?? '',
      })),
    );

    console.log(`Lecturas conjuntas: ${libro.readings.length}`);
    console.log(
      `Candidaturas Clubvisión: ${libro.clubvisionCandidates.length}`,
    );
    console.log(`Clubvisiones ganadas: ${libro.wonClubvisions.length}`);
    console.log(
      `Resultados Clubvisión: ${libro.clubvisionResults.length}`,
    );
  }

  if (libros.length !== 2) {
    console.warn(
      `\n⚠️ Se esperaban 2 libros, pero se han encontrado ${libros.length}.`,
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