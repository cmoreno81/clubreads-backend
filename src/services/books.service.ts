import { Priority, ReadingStatus } from '@prisma/client';
import { prisma } from '../prisma.js';

function statusToFlutter(status: string) {
  if (status === ReadingStatus.READING) return 'LEYENDO';
  if (status === ReadingStatus.FINISHED) return 'FINALIZADO';
  if (status === ReadingStatus.ABANDONED) return 'ABANDONADO';
  if (status === ReadingStatus.REREADING) return 'RELEYENDO';

  return 'PENDIENTE';
}

function priorityToFlutter(priority: string) {
  if (priority === Priority.HIGH) return 'ALTA';
  if (priority === Priority.LOW) return 'BAJA';

  return 'MEDIA';
}

function priorityFromFlutter(value: unknown): Priority {
  const priority = String(value ?? '').trim().toUpperCase();

  if (priority === 'ALTA' || priority === 'HIGH') {
    return Priority.HIGH;
  }

  if (priority === 'BAJA' || priority === 'LOW') {
    return Priority.LOW;
  }

  return Priority.MEDIUM;
}

function ratingFromFlutter(value?: string | null) {
  const rating = String(value ?? '').trim();

  if (!rating) return null;

  if (rating === '⭐' || rating === '⭐️') return 1;
  if (rating === '⭐⭐' || rating === '⭐️⭐️') return 2;
  if (rating === '⭐⭐⭐' || rating === '⭐️⭐️⭐️') return 3;
  if (rating === '⭐⭐⭐⭐' || rating === '⭐️⭐️⭐️⭐️') return 4;
  if (rating === '⭐⭐⭐⭐⭐' || rating === '⭐️⭐️⭐️⭐️⭐️') return 5;

  const numeric = Number(rating);

  return Number.isNaN(numeric) ? null : numeric;
}

function ratingToFlutter(rating?: number | null) {
  if (rating === 0) return '😞';
  if (!rating) return '';

  return '⭐'.repeat(rating);
}

function statusFromFlutter(estado: string): ReadingStatus {
  if (estado === 'LEYENDO') return ReadingStatus.READING;
  if (estado === 'FINALIZADO') return ReadingStatus.FINISHED;
  if (estado === 'ABANDONADO') return ReadingStatus.ABANDONED;

  if (estado === 'RELECTURA' || estado === 'RELEYENDO') {
    return ReadingStatus.REREADING;
  }

  return ReadingStatus.PENDING;
}

function boolFromFlutter(value: unknown) {
  const text = String(value ?? '').trim().toLowerCase();

  return (
    value === true ||
    text === 'si' ||
    text === 'sí' ||
    text === 'true' ||
    text === '1'
  );
}

function buildGoodreadsSearchUrl(title: string) {
  return `https://www.goodreads.com/search?q=${encodeURIComponent(title)}`;
}

/**
 * Permite considerar iguales títulos con:
 * - mayúsculas diferentes;
 * - tildes diferentes;
 * - espacios duplicados;
 * - espacios al principio o al final.
 */
function normalizarTitulo(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * Busca un libro sin depender exactamente de mayúsculas,
 * tildes o espacios.
 */
async function buscarLibroPorTitulo(title: string) {
  const tituloNormalizado = normalizarTitulo(title);

  const libros = await prisma.book.findMany({
    where: {
      deletedAt: null,
    },
  });

  return (
    libros.find(
      (libro) => normalizarTitulo(libro.title) === tituloNormalizado,
    ) ?? null
  );
}

export async function getLibros(usuario: string) {
  const usuarioActual = usuario.trim();

  const library = await prisma.library.findMany({
    where: {
      status: {
        not: ReadingStatus.FINISHED,
      },
    },

    include: {
      book: {
        include: {
          genre: true,
          series: true,
        },
      },
      user: true,
    },

    orderBy: [
      { book: { title: 'asc' } },
      { user: { name: 'asc' } },
    ],
  });

  return library.map((item) => ({
    usuario: item.user.name,
    libro: item.book.title,
    genero: item.book.genre.name,
    saga: item.book.series?.name ?? '',
    numSaga: item.book.seriesOrder ?? '',
    autoconclusivo: item.book.standalone ? 'Si' : 'No',
    prioridad: priorityToFlutter(item.priority),
    leyendo: statusToFlutter(item.status),
    estado: statusToFlutter(item.status),
    valoracion: '',

    yaLoTengo:
      usuarioActual !== '' &&
      item.user.name.trim().toLowerCase() ===
        usuarioActual.toLowerCase(),

    goodreads: item.book.goodreadsUrl ?? '',
  }));
}

export async function getLibrosFinalizados() {
  const library = await prisma.library.findMany({
    where: {
      status: ReadingStatus.FINISHED,
    },

    include: {
      user: true,

      book: {
        include: {
          genre: true,
          series: true,
          reviews: true,
        },
      },
    },

    orderBy: [
      { book: { title: 'asc' } },
      { user: { name: 'asc' } },
    ],
  });

  return library.map((item) => {
    const review = item.book.reviews.find(
      (bookReview) => bookReview.userId === item.userId,
    );

    return {
      usuario: item.user.name,
      libro: item.book.title,
      genero: item.book.genre.name,
      saga: item.book.series?.name ?? '',
      numSaga: item.book.seriesOrder ?? '',
      autoconclusivo: item.book.standalone ? 'Si' : 'No',
      valoracion: ratingToFlutter(review?.rating),
      resena: review?.review ?? '',
      review: review?.review ?? '',
      goodreads: item.book.goodreadsUrl ?? '',
      fecha: item.finishedAt ?? '',

      mes: item.finishedAt
        ? `${String(item.finishedAt.getMonth() + 1).padStart(
            2,
            '0',
          )}/${item.finishedAt.getFullYear()}`
        : '',
    };
  });
}

export async function anadirLibroExistente(
  usuario: string,
  libro: string,
) {
  const user = await prisma.user.findUnique({
    where: {
      name: usuario.trim(),
    },
  });

  if (!user) {
    return {
      ok: false,
      mensaje: 'Usuaria no encontrada',
    };
  }

  const book = await buscarLibroPorTitulo(libro);

  if (!book) {
    return {
      ok: false,
      mensaje: 'Libro no encontrado',
    };
  }

  const existingLibrary = await prisma.library.findUnique({
    where: {
      userId_bookId: {
        userId: user.id,
        bookId: book.id,
      },
    },
  });

  if (existingLibrary) {
    return {
      ok: false,
      codigo: 'LIBRO_YA_EN_BIBLIOTECA',
      mensaje: 'Este libro ya está en tu biblioteca',
    };
  }

  await prisma.library.create({
    data: {
      userId: user.id,
      bookId: book.id,
      status: ReadingStatus.PENDING,
      priority: Priority.MEDIUM,
    },
  });

  return {
    ok: true,
    codigo: 'LIBRO_EXISTENTE_ANADIDO',
    mensaje: 'Libro añadido a tu biblioteca',
  };
}

export async function iniciarLectura(
  usuario: string,
  libro: string,
) {
  return actualizarEstado(usuario, libro, 'LEYENDO');
}

export async function actualizarEstado(
  usuario: string,
  libro: string,
  estado: string,
  valoracion?: string,
  reflexion?: string,
) {
  const user = await prisma.user.findUnique({
    where: {
      name: usuario.trim(),
    },
  });

  if (!user) {
    return {
      ok: false,
      mensaje: 'Usuaria no encontrada',
    };
  }

  const book = await buscarLibroPorTitulo(libro);

  if (!book) {
    return {
      ok: false,
      mensaje: 'Libro no encontrado',
    };
  }

  const status = statusFromFlutter(estado);
  const now = new Date();

  /*
   * No reemplazamos startedAt si la lectura ya había comenzado.
   */
  const currentLibrary = await prisma.library.findUnique({
    where: {
      userId_bookId: {
        userId: user.id,
        bookId: book.id,
      },
    },
  });

  const statusDates =
    status === ReadingStatus.READING
      ? {
          startedAt: currentLibrary?.startedAt ?? now,
          finishedAt: null,
        }
      : status === ReadingStatus.FINISHED
        ? {
            finishedAt: now,
          }
        : status === ReadingStatus.ABANDONED
          ? {
              finishedAt: now,
            }
          : {};

  await prisma.library.upsert({
    where: {
      userId_bookId: {
        userId: user.id,
        bookId: book.id,
      },
    },

    update: {
      status,
      ...statusDates,
    },

    create: {
      userId: user.id,
      bookId: book.id,
      status,
      priority: Priority.MEDIUM,
      ...statusDates,
    },
  });

  const rating = ratingFromFlutter(valoracion);

  if (
    status === ReadingStatus.FINISHED ||
    status === ReadingStatus.ABANDONED
  ) {
    await prisma.review.upsert({
      where: {
        userId_bookId: {
          userId: user.id,
          bookId: book.id,
        },
      },

      update: {
        rating:
          status === ReadingStatus.ABANDONED
            ? 0
            : rating ?? 0,

        review: reflexion?.trim() || null,
      },

      create: {
        userId: user.id,
        bookId: book.id,

        rating:
          status === ReadingStatus.ABANDONED
            ? 0
            : rating ?? 0,

        review: reflexion?.trim() || null,
      },
    });
  }

  return {
    ok: true,
  };
}

export async function actualizarValoracion(
  usuario: string,
  libro: string,
  valoracion: string,
) {
  const user = await prisma.user.findUnique({
    where: {
      name: usuario.trim(),
    },
  });

  if (!user) {
    return {
      ok: false,
      mensaje: 'Usuaria no encontrada',
    };
  }

  const book = await buscarLibroPorTitulo(libro);

  if (!book) {
    return {
      ok: false,
      mensaje: 'Libro no encontrado',
    };
  }

  const rating = ratingFromFlutter(valoracion);

  if (rating === null) {
    return {
      ok: false,
      mensaje: 'Valoración no válida',
    };
  }

  await prisma.review.upsert({
    where: {
      userId_bookId: {
        userId: user.id,
        bookId: book.id,
      },
    },

    update: {
      rating,
    },

    create: {
      userId: user.id,
      bookId: book.id,
      rating,
    },
  });

  return {
    ok: true,
  };
}

export async function crearLibro(data: any) {
  console.log('🔥 ENTRANDO EN CREAR LIBRO NUEVO', data);

  const usuario = String(data.usuario || '').trim();

  const title = String(
    data.libro || data.titulo || data.title || '',
  )
    .trim()
    .replace(/\s+/g, ' ');

  if (!usuario) {
    return {
      ok: false,
      mensaje: 'Falta la usuaria',
    };
  }

  if (!title) {
    return {
      ok: false,
      mensaje: 'Falta el título del libro',
    };
  }

  const user = await prisma.user.findUnique({
    where: {
      name: usuario,
    },
  });

  if (!user) {
    return {
      ok: false,
      mensaje: 'Usuaria no encontrada',
    };
  }

  /*
   * IMPORTANTE:
   * Comprobamos primero si el libro ya existe.
   * No creamos ni modificamos género o saga todavía.
   */
  const existingBook = await buscarLibroPorTitulo(title);

  console.log(
    '📚 LIBRO EXISTENTE:',
    existingBook
      ? {
          id: existingBook.id,
          title: existingBook.title,
        }
      : null,
  );

  if (existingBook) {
    const existingLibrary =
      await prisma.library.findUnique({
        where: {
          userId_bookId: {
            userId: user.id,
            bookId: existingBook.id,
          },
        },
      });

    /*
     * La misma usuaria ya lo tenía:
     * no modificamos libro, género, saga ni prioridad.
     */
    if (existingLibrary) {
      console.log('⛔ LIBRO YA PRESENTE EN SU BIBLIOTECA');

      return {
        ok: false,
        codigo: 'LIBRO_YA_EN_BIBLIOTECA',
        mensaje: 'Este libro ya está en tu biblioteca',

        libro: {
          id: existingBook.id,
          titulo: existingBook.title,
        },
      };
    }

    /*
     * Otra usuaria lo había creado:
     * reutilizamos Book y creamos exclusivamente Library.
     */
    console.log('♻️ AÑADIENDO LIBRO EXISTENTE A OTRA USUARIA');

    await prisma.library.create({
      data: {
        userId: user.id,
        bookId: existingBook.id,
        status: ReadingStatus.PENDING,
        priority: priorityFromFlutter(data.prioridad),
      },
    });

    return {
      ok: true,
      creado: false,
      codigo: 'LIBRO_EXISTENTE_ANADIDO',

      mensaje:
        'El libro ya existía en el club y se ha añadido a tu biblioteca',

      libro: {
        id: existingBook.id,
        titulo: existingBook.title,
      },
    };
  }

  /*
   * Solo si el libro no existe creamos género,
   * saga y el registro Book.
   */
  const genreName =
    String(data.genero || 'Sin género').trim() ||
    'Sin género';

  const seriesName = String(data.saga || '').trim();
  const seriesOrder = String(data.numSaga || '').trim();

  const standalone = boolFromFlutter(
    data.autoconclusivo,
  );

  const goodreadsUrl = String(
    data.goodreads || data.goodreadsUrl || '',
  ).trim();

  const genre = await prisma.genre.upsert({
    where: {
      name: genreName,
    },
    update: {},
    create: {
      name: genreName,
    },
  });

  const series = seriesName
    ? await prisma.series.upsert({
        where: {
          name: seriesName,
        },

        /*
         * No alteramos una saga existente.
         */
        update: {},

        create: {
          name: seriesName,
          genreId: genre.id,
        },
      })
    : null;

  console.log('🆕 CREANDO LIBRO NUEVO');

  /*
   * Libro y biblioteca se crean en la misma transacción.
   */
  const book = await prisma.$transaction(
    async (tx) => {
      const createdBook = await tx.book.create({
        data: {
          title,
          genreId: genre.id,
          seriesId: series?.id ?? null,
          seriesOrder: seriesOrder || null,
          standalone,

          goodreadsUrl:
            goodreadsUrl ||
            buildGoodreadsSearchUrl(title),

          createdById: user.id,
        },
      });

      await tx.library.create({
        data: {
          userId: user.id,
          bookId: createdBook.id,
          status: ReadingStatus.PENDING,

          priority: priorityFromFlutter(
            data.prioridad,
          ),
        },
      });

      return createdBook;
    },
  );

  return {
    ok: true,
    creado: true,
    codigo: 'LIBRO_CREADO',

    mensaje:
      'Libro creado y añadido a tu biblioteca',

    libro: {
      id: book.id,
      titulo: book.title,
    },
  };
}