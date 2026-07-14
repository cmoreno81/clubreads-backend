import { ReadingStatus } from '@prisma/client';

import { prisma } from '../prisma.js';

function ratingToFlutter(rating?: number | null) {
  if (rating === 0) return '😞';
  if (!rating) return '';

  return '⭐'.repeat(rating);
}

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
    .filter((item) => {
      const review = item.book.reviews[0];

      return (
        item.status === ReadingStatus.ABANDONED ||
        review?.rating === 0
      );
    })
    .map((item) => ({
      libro: item.book.title,
      genero: item.book.genre.name,
    }));

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
    .filter(
      (item) => item.status === ReadingStatus.FINISHED,
    )
    .map((item) => item.book.reviews[0]?.rating)
    .filter(
      (rating): rating is number =>
        typeof rating === 'number' && rating > 0,
    );

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
          'Solo se pueden editar las fechas de libros terminados',
      };
    }

    const actualizada = await prisma.library.update({
      where: {
        id: lectura.id,
      },
      data: {
        startedAt: fechaInicio,
        finishedAt: fechaFin,
      },
    });

    return {
      ok: true,
      mensaje: 'Fechas de lectura actualizadas',
      fechaInicio: fechaToFlutter(actualizada.startedAt),
      fechaFin: fechaToFlutter(actualizada.finishedAt),
    };
  } catch (error) {
    return {
      ok: false,
      mensaje:
        error instanceof Error
          ? error.message
          : 'No se han podido actualizar las fechas',
    };
  }
}

export async function actualizarAvatarPerfil(params: {
  usuario: string;
  avatarUrl: string;
}) {
  const usuario = params.usuario.trim();
  const avatarUrl = params.avatarUrl.trim();

  if (!usuario) {
    return {
      ok: false,
      mensaje: 'Falta la usuaria',
    };
  }

  /*
   * Permitimos una cadena vacía para poder eliminar la foto.
   */
  if (
    avatarUrl &&
    !avatarUrl.startsWith('https://') &&
    !avatarUrl.startsWith('http://')
  ) {
    return {
      ok: false,
      mensaje: 'La URL de la imagen no es válida',
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

  await prisma.user.update({
    where: {
      id: user.id,
    },
    data: {
      avatarUrl: avatarUrl || null,
    },
  });

  return {
    ok: true,
    mensaje: avatarUrl
      ? 'Foto de perfil actualizada'
      : 'Foto de perfil eliminada',
    avatarUrl,
  };
}