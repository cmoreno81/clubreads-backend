import { prisma } from '../prisma.js';
import { getClubvision } from './clubvision.service.js';
import { ratingToFlutter } from '../utils/rating.utils.js';

function ratingAverage(ratings: number[]) {
  if (ratings.length === 0) return '0';

  const total = ratings.reduce((sum, rating) => sum + rating, 0);
  return (total / ratings.length).toFixed(2);
}

function currentMonthKey() {
  const now = new Date();
  return `${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`;
}

function tiempoRelativo(fecha: Date) {
  const diffMin = Math.floor((Date.now() - fecha.getTime()) / 60000);

  if (diffMin < 1) return 'ahora';
  if (diffMin < 60) return `hace ${diffMin} min`;

  const horas = Math.floor(diffMin / 60);
  if (horas < 24) return `hace ${horas} h`;
  if (horas < 48) return 'ayer';

  return fecha.toLocaleDateString('es-ES', {
    day: 'numeric',
    month: 'short',
  });
}

function getMood(valoracionMedia: string) {
  const media = Number(valoracionMedia);

  if (media >= 4.4) return 'El club está enamorado de las últimas lecturas 💜';
  if (media >= 4) return 'Las últimas lecturas están gustando mucho 📚';
  if (media >= 3.5) return 'Hay opiniones para todos los gustos 🤔';
  if (media > 0) return 'Necesitamos una lectura que nos reconcilie con el club 😅';

  return 'El club está preparando nuevas lecturas.';
}


export async function getDashboard() {
  const month = currentMonthKey();

  const finishedBooks = await prisma.library.findMany({
    where: {
      status: 'FINISHED',
      finishedAt: { not: null },
    },
    include: {
      user: true,
      book: true,
    },
  });

  const reviews = await prisma.review.findMany({
    where: {
      rating: { gt: 0 },
    },
  });

  const leyendoAhora = await prisma.library.findMany({
    where: {
      status: 'READING',
    },
    include: {
      user: true,
      book: {
        include: {
          genre: true,
        },
      },
    },
    orderBy: {
      updatedAt: 'desc',
    },
  });

  const contadorUsuarios = new Map<string, number>();

  for (const item of finishedBooks) {
    if (!item.finishedAt) continue;

    const itemMonth = `${String(item.finishedAt.getMonth() + 1).padStart(2, '0')}/${item.finishedAt.getFullYear()}`;

    if (itemMonth !== month) continue;

    contadorUsuarios.set(
      item.user.name,
      (contadorUsuarios.get(item.user.name) ?? 0) + 1,
    );
  }

  const topUsuario = Array.from(contadorUsuarios.entries()).sort(
    (a, b) => b[1] - a[1],
  )[0];

  const leyendoPorUsuario = new Map<
    string,
    {
      libros: string[];
      avatarUrl: string;
    }
  >();
  for (const item of leyendoAhora) {
    const actual = leyendoPorUsuario.get(item.user.name) ?? {
      libros: [],
      avatarUrl: item.user.avatarUrl ?? '',
    };

    actual.libros.push(item.book.title);

    leyendoPorUsuario.set(item.user.name, actual);
  }

  const leyendoAhoraResponse = Array.from(leyendoPorUsuario.entries()).map(
    ([usuario, datos]) => ({
      usuario,
      libros: datos.libros,
      total: datos.libros.length,
      avatarUrl: datos.avatarUrl,
    }),
  );

  const clubvision = await getClubvision('');
  const ganador = clubvision.ganador || '';

  const libroActual = ganador
  ? await prisma.book.findFirst({
      where: {
        title: ganador,
        deletedAt: null,
      },
      select: {
        id: true,
        title: true,
        coverUrl: true,
      },
    })
  : null;

  const leyendoLecturaActual = ganador
    ? leyendoAhora
        .filter((item) => item.book.title === ganador)
        .map((item) => item.user.name)
    : [];

  const finalizadosLecturaActual = ganador
    ? await prisma.library.findMany({
        where: {
          status: 'FINISHED',
          book: {
            title: ganador,
          },
        },
        include: {
          user: true,
          book: {
            include: {
              reviews: true,
            },
          },
        },
        orderBy: {
          finishedAt: 'desc',
        },
      })
    : [];

  const lecturaOficial = ganador
    ? await prisma.reading.findFirst({
        where: {
          type: 'CLUBVISION',
          book: {
            title: ganador,
          },
        },
        include: {
          conversations: {
            include: {
              comments: {
                include: {
                  user: true,
                  likes: true,
                  replies: {
                    include: {
                      user: true,
                      likes: true,
                    },
                  },
                },
              },
            },
          },
        },
        orderBy: {
          startedAt: 'desc',
        },
      })
    : null;

  let comentariosLecturaActual = 0;
  let likesLecturaActual = 0;
  let ultimaFechaLecturaActual: Date | null = null;
  let ultimaActividadLecturaActual = '';

  if (lecturaOficial) {
    for (const conversation of lecturaOficial.conversations) {
      for (const comment of conversation.comments) {
        if (comment.deletedAt) continue;

        comentariosLecturaActual++;
        likesLecturaActual += comment.likes.length;

        if (!ultimaFechaLecturaActual || comment.createdAt > ultimaFechaLecturaActual) {
          ultimaFechaLecturaActual = comment.createdAt;
          ultimaActividadLecturaActual = `💬 ${comment.user.name} comentó`;
        }

        for (const reply of comment.replies) {
          if (reply.deletedAt) continue;

          comentariosLecturaActual++;
          likesLecturaActual += reply.likes.length;

          if (!ultimaFechaLecturaActual || reply.createdAt > ultimaFechaLecturaActual) {
            ultimaFechaLecturaActual = reply.createdAt;
            ultimaActividadLecturaActual = `↩️ ${reply.user.name} respondió`;
          }
        }
      }
    }
  }

  const valoracionMedia = ratingAverage(reviews.map((review) => review.rating));

  const genreCounter = new Map<string, number>();

  for (const item of leyendoAhora) {
    const genreName = item.book.genre?.name ?? '';

    if (!genreName) continue;

    genreCounter.set(genreName, (genreCounter.get(genreName) ?? 0) + 1);
  }

  const topGenre = Array.from(genreCounter.entries()).sort(
    (a, b) => b[1] - a[1],
  )[0];

  const tendencia = topGenre
    ? `${topGenre[0]} domina las lecturas actuales del club.`
    : 'El club está repartido entre varios géneros.';

  return {
    resumen: {
      usuarioMes: topUsuario?.[0] ?? '',
      librosUsuarioMes: topUsuario?.[1] ?? 0,
      actividadMes: Array.from(contadorUsuarios.values()).reduce(
        (sum, total) => sum + total,
        0,
      ),
      valoracionMedia,
    },

    leyendoAhora: leyendoAhoraResponse,

    tendencia,
    mood: getMood(valoracionMedia),
    libroMes: [],
    clubvision,

    lecturaActual: {
      ok: Boolean(ganador),
      titulo: ganador || clubvision.mensaje || '',
      comentarios: comentariosLecturaActual,
      likes: likesLecturaActual,
      ultimaActividad: ultimaFechaLecturaActual
        ? `${ultimaActividadLecturaActual} ${tiempoRelativo(ultimaFechaLecturaActual)}`
        : '',
      totalLeyendo: leyendoLecturaActual.length,
      totalFinalizado: finalizadosLecturaActual.length,
      leyendo: leyendoLecturaActual,
     coverUrl: libroActual?.coverUrl ?? '',
      finalizado: finalizadosLecturaActual.map((item) => {
        const review = item.book.reviews.find(
          (review) => review.userId === item.userId,
        );

        return {
          usuario: item.user.name,
          valoracion: ratingToFlutter(review?.rating),
        };
      }),
    },
  };
}