import { prisma } from '../src/prisma.js';

const BOOK_ID_DEFINITIVO = 'cmrd84m2t00f7in50ttsrqcbo';
const BOOK_ID_DUPLICADO = 'cmrd84lnz000pin50ixbf6o8j';

async function main() {
  console.log('🔎 Comprobando los libros antes de fusionarlos...');

  const [definitivo, duplicado] = await Promise.all([
    prisma.book.findUnique({
      where: { id: BOOK_ID_DEFINITIVO },
      include: {
        library: true,
        reviews: true,
        readings: true,
        clubvisionCandidates: true,
        wonClubvisions: true,
        clubvisionResults: true,
      },
    }),

    prisma.book.findUnique({
      where: { id: BOOK_ID_DUPLICADO },
      include: {
        library: true,
        reviews: true,
        readings: true,
        clubvisionCandidates: true,
        wonClubvisions: true,
        clubvisionResults: true,
      },
    }),
  ]);

  if (!definitivo) {
    throw new Error(
      `No existe el libro definitivo ${BOOK_ID_DEFINITIVO}`,
    );
  }

  if (!duplicado) {
    throw new Error(
      `No existe el libro duplicado ${BOOK_ID_DUPLICADO}`,
    );
  }

  console.log('');
  console.log('Libro definitivo:');
  console.log({
    id: definitivo.id,
    titulo: definitivo.title,
    bibliotecas: definitivo.library.length,
    resenas: definitivo.reviews.length,
  });

  console.log('');
  console.log('Libro duplicado:');
  console.log({
    id: duplicado.id,
    titulo: duplicado.title,
    bibliotecas: duplicado.library.length,
    resenas: duplicado.reviews.length,
  });

  const usuariosDefinitivo = new Set(
    definitivo.library.map((item) => item.userId),
  );

  const usuariosDuplicado = new Set(
    duplicado.library.map((item) => item.userId),
  );

  const usuariosBibliotecaRepetidos = [...usuariosDuplicado].filter(
    (userId) => usuariosDefinitivo.has(userId),
  );

  if (usuariosBibliotecaRepetidos.length > 0) {
    throw new Error(
      `Hay usuarias con ambos libros en su biblioteca: ` +
        usuariosBibliotecaRepetidos.join(', '),
    );
  }

  const resenasDefinitivo = new Set(
    definitivo.reviews.map((item) => item.userId),
  );

  const resenasDuplicado = new Set(
    duplicado.reviews.map((item) => item.userId),
  );

  const usuariosResenaRepetidos = [...resenasDuplicado].filter(
    (userId) => resenasDefinitivo.has(userId),
  );

  if (usuariosResenaRepetidos.length > 0) {
    throw new Error(
      `Hay usuarias con reseñas en ambos libros: ` +
        usuariosResenaRepetidos.join(', '),
    );
  }

  console.log('');
  console.log('🚚 Iniciando fusión...');

  const resultado = await prisma.$transaction(async (tx) => {
    const bibliotecas = await tx.library.updateMany({
      where: {
        bookId: BOOK_ID_DUPLICADO,
      },
      data: {
        bookId: BOOK_ID_DEFINITIVO,
      },
    });

    const resenas = await tx.review.updateMany({
      where: {
        bookId: BOOK_ID_DUPLICADO,
      },
      data: {
        bookId: BOOK_ID_DEFINITIVO,
      },
    });

    const lecturas = await tx.reading.updateMany({
      where: {
        bookId: BOOK_ID_DUPLICADO,
      },
      data: {
        bookId: BOOK_ID_DEFINITIVO,
      },
    });

    const candidaturas = await tx.clubvisionCandidate.updateMany({
      where: {
        bookId: BOOK_ID_DUPLICADO,
      },
      data: {
        bookId: BOOK_ID_DEFINITIVO,
      },
    });

    const clubvisionsGanadas = await tx.clubvision.updateMany({
      where: {
        winnerBookId: BOOK_ID_DUPLICADO,
      },
      data: {
        winnerBookId: BOOK_ID_DEFINITIVO,
      },
    });

    const resultadosClubvision = await tx.clubvisionResult.updateMany({
      where: {
        winnerBookId: BOOK_ID_DUPLICADO,
      },
      data: {
        winnerBookId: BOOK_ID_DEFINITIVO,
      },
    });

    const libroActualizado = await tx.book.update({
      where: {
        id: BOOK_ID_DEFINITIVO,
      },
      data: {
        title: 'Amiga Mía',

        coverUrl:
          definitivo.coverUrl?.trim() ||
          duplicado.coverUrl?.trim() ||
          null,

        goodreadsUrl:
          definitivo.goodreadsUrl?.trim() ||
          duplicado.goodreadsUrl?.trim() ||
          null,

        synopsis:
          definitivo.synopsis?.trim() ||
          duplicado.synopsis?.trim() ||
          null,

        isbn:
          definitivo.isbn?.trim() ||
          duplicado.isbn?.trim() ||
          null,

        publicationYear:
          definitivo.publicationYear ??
          duplicado.publicationYear,

        authorId:
          definitivo.authorId ??
          duplicado.authorId,

        seriesId:
          definitivo.seriesId ??
          duplicado.seriesId,

        seriesOrder:
          definitivo.seriesOrder?.trim() ||
          duplicado.seriesOrder?.trim() ||
          null,
      },
    });

    await tx.book.delete({
      where: {
        id: BOOK_ID_DUPLICADO,
      },
    });

    return {
      libroActualizado,
      bibliotecasMovidas: bibliotecas.count,
      resenasMovidas: resenas.count,
      lecturasMovidas: lecturas.count,
      candidaturasMovidas: candidaturas.count,
      clubvisionsActualizadas: clubvisionsGanadas.count,
      resultadosActualizados: resultadosClubvision.count,
    };
  });

  console.log('');
  console.log('✅ Fusión completada');
  console.log({
    libroId: resultado.libroActualizado.id,
    titulo: resultado.libroActualizado.title,
    goodreadsUrl: resultado.libroActualizado.goodreadsUrl,
    bibliotecasMovidas: resultado.bibliotecasMovidas,
    resenasMovidas: resultado.resenasMovidas,
    lecturasMovidas: resultado.lecturasMovidas,
    candidaturasMovidas: resultado.candidaturasMovidas,
    clubvisionsActualizadas:
      resultado.clubvisionsActualizadas,
    resultadosActualizados:
      resultado.resultadosActualizados,
  });
}

main()
  .catch((error) => {
    console.error('');
    console.error('❌ No se pudo completar la fusión:');
    console.error(error);

    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });