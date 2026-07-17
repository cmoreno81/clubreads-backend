import { ReadingStatus } from '@prisma/client';

import { prisma } from '../prisma.js';
import {
  ratingFromFlutter,
  ratingToFlutter,
} from '../utils/rating.utils.js';
import {
  subirAvatarDesdeBase64,
  subirAvatarDesdeUrl,
} from './cloudinary.service.js';

function fechaToFlutter(fecha?: Date | null) {
  if (!fecha) return '';

  return fecha.toLocaleDateString('es-ES', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function parseFecha(
  valor: unknown,
  campo: string,
): Date | null {
  const texto = String(valor ?? '').trim();

  if (!texto) {
    return null;
  }

  /*
   * Flutter enviará las fechas en formato yyyy-MM-dd.
   * Usamos mediodía UTC para evitar cambios de día por zona horaria.
   */
  const coincidencia = /^(\d{4})-(\d{2})-(\d{2})$/.exec(texto);

  if (!coincidencia) {
    throw new Error(`${campo} no tiene un formato válido`);
  }

  const anio = Number(coincidencia[1]);
  const mes = Number(coincidencia[2]);
  const dia = Number(coincidencia[3]);

  const fecha = new Date(
    Date.UTC(anio, mes - 1, dia, 12, 0, 0),
  );

  if (
    fecha.getUTCFullYear() !== anio ||
    fecha.getUTCMonth() !== mes - 1 ||
    fecha.getUTCDate() !== dia
  ) {
    throw new Error(`${campo} no es una fecha válida`);
  }

  return fecha;
}

export async function getPerfilUsuario(usuario: string) {
  const nombre = usuario.trim();

  if (!nombre) {
    return {
      ok: false,
      mensaje: 'Falta el nombre de la usuaria',
    };
  }

  const user = await prisma.user.findUnique({
    where: {
      name: nombre,
    },
  });

  if (!user) {
    return {
      ok: false,
      mensaje: 'Usuaria no encontrada',
    };
  }

  const biblioteca = await prisma.library.findMany({
    where: {
      userId: user.id,
    },
    include: {
      book: {
        include: {
          genre: true,
          reviews: {
            where: {
              userId: user.id,
              deletedAt: null,
            },
          },
        },
      },
    },
    orderBy: [
      {
        finishedAt: 'desc',
      },
      {
        updatedAt: 'desc',
      },
    ],
  });

  const esAbandonado = (
  item: (typeof biblioteca)[number],
) => {
  const review = item.book.reviews[0];

  return (
    item.status === ReadingStatus.ABANDONED ||
    review?.rating === 0
  );
};

  const comentarios = await prisma.comment.findMany({
    where: {
      userId: user.id,
      deletedAt: null,
    },
    include: {
      likes: true,
    },
  });

  const likesRecibidos = comentarios.reduce(
    (total, comentario) => total + comentario.likes.length,
    0,
  );

const terminados = biblioteca
  .filter(
    (item) => item.status === ReadingStatus.FINISHED,
  )
  .map((item) => {
    const review = item.book.reviews[0];

    return {
      libraryId: item.id,
      bookId: item.bookId,
      libro: item.book.title,
      genero: item.book.genre.name,
      fechaInicio: fechaToFlutter(item.startedAt),
      fechaFin: fechaToFlutter(item.finishedAt),
      valoracion: ratingToFlutter(review?.rating),
      resena: review?.review ?? '',
      coverUrl: item.book.coverUrl ?? '',
    };
  });

const abandonados = biblioteca
  .filter(
    (item) => item.status === ReadingStatus.ABANDONED,
  )
  .map((item) => {
    const review = item.book.reviews[0];

    return {
      libraryId: item.id,
      bookId: item.bookId,
      libro: item.book.title,
      genero: item.book.genre.name,
      fechaInicio: fechaToFlutter(item.startedAt),
      fechaFin: fechaToFlutter(item.finishedAt),
      valoracion: ratingToFlutter(review?.rating),
      resena: review?.review ?? '',
      coverUrl: item.book.coverUrl ?? '',
    };
  });

  const leyendo = biblioteca
    .filter(
      (item) => item.status === ReadingStatus.READING,
    )
    .map((item) => ({
      libro: item.book.title,
      genero: item.book.genre.name,
    }));

  const pendientes = biblioteca
    .filter(
      (item) => item.status === ReadingStatus.PENDING,
    )
    .map((item) => ({
      libro: item.book.title,
      genero: item.book.genre.name,
    }));



  /*
   * TypeScript no tiene `.where`, así que calculamos la media
   * de forma explícita.
   */
const valoresRating = biblioteca
  .filter((item) => {
    const review = item.book.reviews[0];

    return (
      item.status === ReadingStatus.FINISHED &&
      typeof review?.rating === 'number' &&
      review.rating > 0
    );
  })
  .map((item) => item.book.reviews[0]!.rating);

  const media =
    valoresRating.length === 0
      ? 0
      : Number(
          (
            valoresRating.reduce(
              (suma, rating) => suma + rating,
              0,
            ) / valoresRating.length
          ).toFixed(2),
        );

  const generos = new Map<string, number>();

  for (const item of terminados) {
    generos.set(
      item.genero,
      (generos.get(item.genero) ?? 0) + 1,
    );
  }

  const generosFavoritos = Array.from(
    generos.entries(),
  )
    .map(([genero, total]) => ({
      genero,
      total,
    }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 5);

  return {
    ok: true,
    usuario: user.name,
    email: user.email,
    avatarUrl: user.avatarUrl ?? '',

    resumen: {
      terminados: terminados.length,
      leyendo: leyendo.length,
      pendientes: pendientes.length,
      abandonados: abandonados.length,
      media,
      comentarios: comentarios.length,
      likesRecibidos,
    },

    leyendo,
    terminados,
    abandonados,
    pendientes,
    generosFavoritos,
  };
}

export async function actualizarFechasLectura(params: {
  usuario: string;
  libraryId: string;
  fechaInicio: unknown;
  fechaFin: unknown;
  valoracion?: unknown;
  resena?: unknown;
}) {
  const usuario = params.usuario.trim();
  const libraryId = params.libraryId.trim();

  if (!usuario) {
    return {
      ok: false,
      mensaje: 'Falta la usuaria',
    };
  }

  if (!libraryId) {
    return {
      ok: false,
      mensaje: 'Falta el identificador de la lectura',
    };
  }

  try {
    const fechaInicio = parseFecha(
      params.fechaInicio,
      'La fecha de inicio',
    );

    const fechaFin = parseFecha(
      params.fechaFin,
      'La fecha de fin',
    );

    if (
      fechaInicio &&
      fechaFin &&
      fechaFin.getTime() < fechaInicio.getTime()
    ) {
      return {
        ok: false,
        mensaje:
          'La fecha de fin no puede ser anterior a la fecha de inicio',
      };
    }

    const user = await prisma.user.findUnique({
      where: {
        name: usuario,
      },
      select: {
        id: true,
      },
    });

    if (!user) {
      return {
        ok: false,
        mensaje: 'Usuaria no encontrada',
      };
    }

    const lectura = await prisma.library.findFirst({
      where: {
        id: libraryId,
        userId: user.id,
      },
      select: {
        id: true,
        bookId: true,
        status: true,
      },
    });

    if (!lectura) {
      return {
        ok: false,
        mensaje: 'Lectura no encontrada',
      };
    }

    if (lectura.status !== ReadingStatus.FINISHED) {
      return {
        ok: false,
        mensaje:
          'Solo se pueden editar libros terminados',
      };
    }

    const valoracionFueEnviada =
      params.valoracion !== undefined;

    const resenaFueEnviada =
      params.resena !== undefined;

    const textoValoracion = valoracionFueEnviada
      ? String(params.valoracion ?? '').trim()
      : '';

    const textoResena = resenaFueEnviada
      ? String(params.resena ?? '').trim()
      : '';

    const rating = valoracionFueEnviada
      ? ratingFromFlutter(textoValoracion)
      : undefined;

    /*
     * Permitimos borrar la valoración enviando una cadena vacía.
     * En ese caso eliminamos la Review si tampoco queda reseña.
     */
    await prisma.$transaction(async (tx) => {
      await tx.library.update({
        where: {
          id: lectura.id,
        },
        data: {
          startedAt: fechaInicio,
          finishedAt: fechaFin,
        },
      });

      if (!valoracionFueEnviada && !resenaFueEnviada) {
        return;
      }

      const reviewActual = await tx.review.findUnique({
        where: {
          userId_bookId: {
            userId: user.id,
            bookId: lectura.bookId,
          },
        },
      });

      const ratingFinal = valoracionFueEnviada
        ? rating
        : reviewActual?.rating;

      const resenaFinal = resenaFueEnviada
        ? textoResena || null
        : reviewActual?.review ?? null;

      /*
       * Si no queda ni valoración ni reseña, eliminamos la review.
       * Esto permite usar "Quitar valoración" de forma real.
       */
      if (
        ratingFinal === undefined ||
        ratingFinal === null
      ) {
        if (!resenaFinal) {
          if (reviewActual) {
            await tx.review.delete({
              where: {
                id: reviewActual.id,
              },
            });
          }

          return;
        }

        /*
         * El modelo Review exige rating. Si existe reseña pero se ha
         * quitado la valoración, conservamos el rating anterior cuando
         * sea posible. Si no existía, no creamos una Review inválida.
         */
        if (!reviewActual) {
          throw new Error(
            'No se puede guardar una reseña sin valoración',
          );
        }
      }

      await tx.review.upsert({
        where: {
          userId_bookId: {
            userId: user.id,
            bookId: lectura.bookId,
          },
        },
        update: {
          rating: ratingFinal ?? reviewActual!.rating,
          review: resenaFinal,
          edited: true,
          deletedAt: null,
        },
        create: {
          userId: user.id,
          bookId: lectura.bookId,
          rating: ratingFinal!,
          review: resenaFinal,
          edited: true,
        },
      });
    });

    return {
      ok: true,
      mensaje: 'Lectura actualizada correctamente',
      fechaInicio: fechaToFlutter(fechaInicio),
      fechaFin: fechaToFlutter(fechaFin),
      valoracion:
        valoracionFueEnviada && rating != null
          ? ratingToFlutter(rating)
          : undefined,
      resena:
        resenaFueEnviada
          ? textoResena
          : undefined,
    };
  } catch (error) {
    return {
      ok: false,
      mensaje:
        error instanceof Error
          ? error.message
          : 'No se ha podido actualizar la lectura',
    };
  }
}

export async function actualizarAvatarPerfil(params: {
  usuario: string;
  avatarUrl: string;
}) {
  const usuario = params.usuario.trim();
  const avatarRecibido = params.avatarUrl.trim();

  if (!usuario) {
    return {
      ok: false,
      mensaje: 'Falta la usuaria',
    };
  }

  const user = await prisma.user.findUnique({
    where: {
      name: usuario,
    },
    select: {
      id: true,
    },
  });

  if (!user) {
    return {
      ok: false,
      mensaje: 'Usuaria no encontrada',
    };
  }

  /*
   * Una cadena vacía elimina la foto actual.
   */
  if (!avatarRecibido) {
    await prisma.user.update({
      where: {
        id: user.id,
      },
      data: {
        avatarUrl: null,
      },
    });

    return {
      ok: true,
      mensaje: 'Foto de perfil eliminada',
      avatarUrl: '',
    };
  }

  try {
    let avatarCloudinary: string;

    /*
     * Imagen seleccionada desde la galería de Flutter.
     */
    if (avatarRecibido.startsWith('data:image/')) {
      const resultado = await subirAvatarDesdeBase64({
        imageBase64: avatarRecibido,
        usuario,
      });

      avatarCloudinary = resultado.url;
    } else {
      /*
       * Imagen pegada desde Internet.
       */
      const uri = new URL(avatarRecibido);

      if (uri.protocol !== 'https:' && uri.protocol !== 'http:') {
        return {
          ok: false,
          mensaje: 'La URL de la imagen no es válida',
        };
      }

      const resultado = await subirAvatarDesdeUrl({
        imageUrl: avatarRecibido,
        usuario,
      });

      avatarCloudinary = resultado.url;
    }

    await prisma.user.update({
      where: {
        id: user.id,
      },
      data: {
        avatarUrl: avatarCloudinary,
      },
    });

    return {
      ok: true,
      mensaje: 'Foto de perfil actualizada',
      avatarUrl: avatarCloudinary,
    };
  } catch (error) {
    console.error('Error actualizando avatar:', error);

    return {
      ok: false,
      mensaje:
        error instanceof Error
          ? error.message
          : 'No se ha podido procesar la imagen',
    };
  }
}