import {
  Prisma,
  Priority,
  ReactionType,
  ReadingFormat,
  ReadingStatus,
} from '@prisma/client';
import { prisma } from '../prisma.js';
import { findBestBookCover } from './book-cover.service.js';
import {
  ratingFromFlutter,
  ratingToFlutter,
} from '../utils/rating.utils.js';
import { getCurrentClubContext } from './club-context.service.js';

function statusToFlutter(status: string) {
  if (status === ReadingStatus.READING) return 'LEYENDO';
  if (status === ReadingStatus.PAUSED) return 'PAUSADO';
  if (status === ReadingStatus.FINISHED) return 'FINALIZADO';
  if (status === ReadingStatus.ABANDONED) return 'ABANDONADO';
  if (status === ReadingStatus.REREADING) return 'RELECTURA';

  return 'PENDIENTE';
}

export async function toggleProgressReaction(
  usuario: string,
  libraryId: string,
  reactionValue: string,
) {
  const { club, user } = await getCurrentClubContext(usuario.trim());
  if (!user) return { ok: false, mensaje: 'Usuaria no encontrada' };
  const reaction = Object.values(ReactionType).includes(
    reactionValue as ReactionType,
  )
    ? (reactionValue as ReactionType)
    : ReactionType.LIKE;
  const target = await prisma.library.findFirst({
    where: {
      id: libraryId.trim(),
      user: { clubMemberships: { some: { clubId: club.id } } },
    },
    select: { id: true },
  });
  if (!target) return { ok: false, mensaje: 'Progreso no encontrado' };

  const current = await prisma.progressReaction.findUnique({
    where: {
      libraryId_userId: { libraryId: target.id, userId: user.id },
    },
  });
  if (current?.reaction === reaction) {
    await prisma.progressReaction.delete({ where: { id: current.id } });
  } else {
    await prisma.progressReaction.upsert({
      where: {
        libraryId_userId: { libraryId: target.id, userId: user.id },
      },
      update: { reaction },
      create: { libraryId: target.id, userId: user.id, reaction },
    });
  }

  const reactions = await prisma.progressReaction.findMany({
    where: { libraryId: target.id },
    select: { userId: true, reaction: true },
  });
  return {
    ok: true,
    reacciones: contarReaccionesProgreso(reactions),
    miReaccion:
      reactions.find((item) => item.userId === user.id)?.reaction ?? null,
  };
}

function contarReaccionesProgreso(
  reactions: Array<{ reaction: ReactionType }>,
) {
  return Object.fromEntries(
    Object.values(ReactionType).map((reaction) => [
      reaction,
      reactions.filter((item) => item.reaction === reaction).length,
    ]),
  );
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

export function formatToFlutter(format: ReadingFormat | null) {
  if (format === ReadingFormat.PHYSICAL) return 'FISICO';
  if (format === ReadingFormat.DIGITAL) return 'DIGITAL';
  if (format === ReadingFormat.AUDIOBOOK) return 'AUDIOLIBRO';
  return '';
}

function formatFromFlutter(value: unknown): ReadingFormat | null {
  const format = String(value ?? '').trim().toUpperCase();
  if (format === 'FISICO' || format === 'FÍSICO' || format === 'PHYSICAL') {
    return ReadingFormat.PHYSICAL;
  }
  if (format === 'DIGITAL') return ReadingFormat.DIGITAL;
  if (format === 'AUDIOLIBRO' || format === 'AUDIOBOOK') {
    return ReadingFormat.AUDIOBOOK;
  }
  return null;
}



function statusFromFlutter(value: string) {
  const estado = value.trim().toUpperCase();

  if (estado === 'LEYENDO') return ReadingStatus.READING;
  if (estado === 'PAUSADO') return ReadingStatus.PAUSED;
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
    .replace(/[’‘`´]/g, "'")
    .replace(/[–—]/g, '-')
    .replace(/\u00A0/g, ' ')
    .toLocaleLowerCase('es')
    .trim()
    .replace(/\s+/g, ' ');
}

function distanciaEdicion(left: string, right: string) {
  const previous = Array.from(
    { length: right.length + 1 },
    (_, index) => index,
  );
  for (let i = 1; i <= left.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= right.length; j += 1) {
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + (left[i - 1] === right[j - 1] ? 0 : 1),
      );
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[right.length];
}

async function buscarOCrearSaga(
  nombre: string,
  genreId: string,
  preferredSeriesId?: string | null,
) {
  const normalizado = normalizarTitulo(nombre);
  const existentes = await prisma.series.findMany();
  const equivalentes = existentes.filter((series) => {
    const candidata = normalizarTitulo(series.name);
    if (candidata === normalizado) return true;
    return (
      normalizado.length >= 8 &&
      candidata.split(' ').length === normalizado.split(' ').length &&
      distanciaEdicion(candidata, normalizado) <= 1
    );
  });
  const preferida = preferredSeriesId
    ? equivalentes.find((series) => series.id === preferredSeriesId)
    : null;
  const coincidencia = preferida ?? equivalentes[0];

  if (coincidencia) {
    const duplicadas = equivalentes.filter(
      (series) => series.id !== coincidencia.id,
    );
    const totalBooks = Math.max(
      coincidencia.totalBooks ?? 0,
      ...equivalentes.map((series) => series.totalBooks ?? 0),
    );

    if (
      coincidencia.name !== nombre ||
      duplicadas.length > 0 ||
      (coincidencia.totalBooks ?? 0) !== totalBooks
    ) {
      await prisma.$transaction(async (tx) => {
        if (duplicadas.length > 0) {
          await tx.book.updateMany({
            where: {
              seriesId: {
                in: duplicadas.map((series) => series.id),
              },
            },
            data: {
              seriesId: coincidencia.id,
            },
          });
          await tx.series.deleteMany({
            where: {
              id: {
                in: duplicadas.map((series) => series.id),
              },
            },
          });
        }
        await tx.series.update({
          where: { id: coincidencia.id },
          data: {
            name: nombre,
            genreId,
            totalBooks: totalBooks > 0 ? totalBooks : null,
          },
        });
      });
    }

    return {
      ...coincidencia,
      name: nombre,
      genreId,
      totalBooks: totalBooks > 0 ? totalBooks : null,
    };
  }
  return prisma.series.create({
    data: { name: nombre, genreId },
  });
}

/**
 * Busca un libro sin depender exactamente de mayúsculas,
 * tildes o espacios.
 */
async function buscarLibroPorTitulo(
  titulo: string,
) {
  const tituloNormalizado = normalizarTitulo(titulo);

  if (!tituloNormalizado) {
    return null;
  }

  const libros = await prisma.book.findMany({
    where: {
      deletedAt: null,
    },
    select: {
      id: true,
      title: true,
      genreId: true,
      seriesId: true,
      seriesOrder: true,
      standalone: true,
      goodreadsUrl: true,
      coverUrl: true,
      isbn: true,
    publicationYear: true,
      totalPages: true,
    },
  });

  return (
    libros.find(
      (libro) =>
        normalizarTitulo(libro.title) === tituloNormalizado,
    ) ?? null
  );
}

export async function getLibros(usuario: string) {
  const usuarioActual = usuario.trim();
  const { club, user } = await getCurrentClubContext(usuarioActual);

  const library = await prisma.library.findMany({
    where: {
      user: { clubMemberships: { some: { clubId: club.id } } },
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
    bookId: item.book.id,
    usuario: item.user.name,
    libro: item.book.title,
    genero: item.book.genre.name,
    saga: item.book.series?.name ?? '',
    numSaga: item.book.seriesOrder ?? '',
    autoconclusivo: item.book.standalone ? 'Si' : 'No',
    prioridad: priorityToFlutter(item.priority),
    formato: formatToFlutter(item.readingFormat),
    leyendo: statusToFlutter(item.status),
    estado: statusToFlutter(item.status),
    valoracion: '',
    fechaAlta: item.book.createdAt.toISOString(),
    startedAt: item.startedAt?.toISOString() ?? '',
    pausedAt: item.pausedAt?.toISOString() ?? '',
    pauseReason: item.pauseReason ?? '',
    yaLoTengo: item.userId === user?.id,

    goodreads: item.book.goodreadsUrl ?? '',
    coverUrl: item.book.coverUrl ?? '',
    avatarUrl: item.user.avatarUrl ?? '',
    paginas: item.book.totalPages,
  }));
}

export async function getLibrosFinalizados(usuario: string) {
  const { club, user } = await getCurrentClubContext(usuario);
  const library = await prisma.library.findMany({
    where: {
      user: { clubMemberships: { some: { clubId: club.id } } },
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
      bookId: item.book.id,
      usuario: item.user.name,
      libro: item.book.title,
      genero: item.book.genre.name,
      saga: item.book.series?.name ?? '',
      numSaga: item.book.seriesOrder ?? '',
      autoconclusivo: item.book.standalone ? 'Si' : 'No',
      valoracion: ratingToFlutter(review?.rating),
      formato: formatToFlutter(item.readingFormat),
      fechaAlta: item.book.createdAt.toISOString(),
      resena: review?.review ?? '',
      review: review?.review ?? '',
      goodreads: item.book.goodreadsUrl ?? '',
      fecha: item.finishedAt ?? '',
      coverUrl: item.book.coverUrl ?? '',
      avatarUrl: item.user.avatarUrl ?? '',
      paginas: item.book.totalPages,
      yaLoTengo: item.userId === user?.id,
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
  prioridad?: string,
  formato?: string,
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
      priority: priorityFromFlutter(prioridad),
      readingFormat: formatFromFlutter(formato),
    },
  });

  return {
    ok: true,
    codigo: 'LIBRO_EXISTENTE_ANADIDO',
    mensaje: 'Libro añadido a tu biblioteca',
  };
}

export async function actualizarPreferenciasLibro(
  usuario: string,
  libro: string,
  prioridad: string,
  formato: string,
) {
  const user = await prisma.user.findUnique({
    where: { name: usuario.trim() },
  });
  if (!user) return { ok: false, mensaje: 'Usuaria no encontrada' };

  const book = await buscarLibroPorTitulo(libro);
  if (!book) return { ok: false, mensaje: 'Libro no encontrado' };

  const library = await prisma.library.findUnique({
    where: {
      userId_bookId: { userId: user.id, bookId: book.id },
    },
  });
  if (!library) {
    return { ok: false, mensaje: 'El libro no está en tu biblioteca' };
  }

  await prisma.library.update({
    where: { id: library.id },
    data: {
      priority: priorityFromFlutter(prioridad),
      readingFormat: formatFromFlutter(formato),
    },
  });

  return {
    ok: true,
    prioridad: priorityToFlutter(priorityFromFlutter(prioridad)),
    formato: formatToFlutter(formatFromFlutter(formato)),
  };
}

export async function iniciarLectura(
  usuario: string,
  libro: string,
) {
  return actualizarEstado(usuario, libro, 'LEYENDO');
}

export async function actualizarProgresoLectura(
  usuario: string,
  libro: string,
  progreso: number,
  comentario: string,
  paginaActual?: number,
  paginasTotales?: number,
) {
  let porcentaje = Math.round(Number(progreso));
  const paginaFueEnviada = paginaActual !== undefined;
  const totalFueEnviado = paginasTotales !== undefined;
  const totalEnviado = Number(paginasTotales);
  if (
    totalFueEnviado &&
    (!Number.isInteger(totalEnviado) || totalEnviado <= 0)
  ) {
    return { ok: false, mensaje: 'El número de páginas no es válido' };
  }
  if (
    !paginaFueEnviada &&
    (!Number.isFinite(porcentaje) || porcentaje < 0 || porcentaje > 100)
  ) {
    return { ok: false, mensaje: 'El progreso debe estar entre 0 y 100' };
  }

  const lectura = await prisma.library.findFirst({
    where: {
      user: { name: usuario.trim() },
      book: { title: libro.trim() },
      status: { in: [ReadingStatus.READING, ReadingStatus.REREADING] },
    },
    include: {
      book: { select: { totalPages: true } },
    },
  });
  if (!lectura) return { ok: false, mensaje: 'Lectura activa no encontrada' };

  let pagina: number | null = null;
  if (paginaFueEnviada) {
    pagina = Math.round(Number(paginaActual));
    const totalPaginas = totalFueEnviado
      ? totalEnviado
      : lectura.book.totalPages;
    if (!totalPaginas) {
      return { ok: false, mensaje: 'El libro no tiene páginas configuradas' };
    }
    if (!Number.isFinite(pagina) || pagina < 0 || pagina > totalPaginas) {
      return {
        ok: false,
        mensaje: `La página debe estar entre 0 y ${totalPaginas}`,
      };
    }
    porcentaje = Math.round((pagina / totalPaginas) * 100);
  }

  await prisma.$transaction([
    ...(lectura.progressNote !== (comentario.trim() || null)
      ? [
          prisma.progressReaction.deleteMany({
            where: { libraryId: lectura.id },
          }),
        ]
      : []),
    prisma.library.update({
      where: { id: lectura.id },
      data: {
        lastProgress: porcentaje,
        currentPage: pagina,
        progressNote: comentario.trim() || null,
        progressUpdatedAt: new Date(),
      },
    }),
    ...(totalFueEnviado
      ? [
          prisma.book.update({
            where: { id: lectura.bookId },
            data: { totalPages: totalEnviado },
          }),
        ]
      : []),
  ]);
  return { ok: true, progreso: porcentaje, paginaActual: pagina };
}

export async function actualizarEstado(
  usuario: string,
  libro: string,
  estado: string,
  valoracion?: string,
  reflexion?: string,
  motivoPausa?: string,
  fechaInicio?: string,
  fechaFin?: string,
  formato?: string,
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
  const requestedFormat = formatFromFlutter(formato);
  const now = new Date();
  const fechaInicioTexto = fechaInicio?.trim() ?? '';
  const fechaFinTexto = fechaFin?.trim() ?? '';
  const coincidenciaFecha = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fechaInicioTexto);
  let fechaInicioEditada: Date | null = null;
  let fechaFinEditada: Date | null = null;

  if (fechaInicioTexto) {
    if (!coincidenciaFecha) {
      return { ok: false, mensaje: 'La fecha de inicio no es válida' };
    }
    fechaInicioEditada = new Date(
      Date.UTC(
        Number(coincidenciaFecha[1]),
        Number(coincidenciaFecha[2]) - 1,
        Number(coincidenciaFecha[3]),
        12,
      ),
    );
    if (
      Number.isNaN(fechaInicioEditada.getTime()) ||
      fechaInicioEditada.getUTCFullYear() !== Number(coincidenciaFecha[1]) ||
      fechaInicioEditada.getUTCMonth() !== Number(coincidenciaFecha[2]) - 1 ||
      fechaInicioEditada.getUTCDate() !== Number(coincidenciaFecha[3]) ||
      fechaInicioEditada > now
    ) {
      return { ok: false, mensaje: 'La fecha de inicio no es válida' };
    }
  }

  if (fechaFinTexto) {
    const coincidenciaFin = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fechaFinTexto);
    if (!coincidenciaFin) {
      return { ok: false, mensaje: 'La fecha de finalización no es válida' };
    }
    fechaFinEditada = new Date(
      Date.UTC(
        Number(coincidenciaFin[1]),
        Number(coincidenciaFin[2]) - 1,
        Number(coincidenciaFin[3]),
        12,
      ),
    );
    if (
      Number.isNaN(fechaFinEditada.getTime()) ||
      fechaFinEditada.getUTCFullYear() !== Number(coincidenciaFin[1]) ||
      fechaFinEditada.getUTCMonth() !== Number(coincidenciaFin[2]) - 1 ||
      fechaFinEditada.getUTCDate() !== Number(coincidenciaFin[3]) ||
      fechaFinEditada > now
    ) {
      return { ok: false, mensaje: 'La fecha de finalización no es válida' };
    }
  }

  if (
    fechaInicioEditada &&
    fechaFinEditada &&
    fechaFinEditada < fechaInicioEditada
  ) {
    return {
      ok: false,
      mensaje: 'La fecha de finalización no puede ser anterior al inicio',
    };
  }

const rating = ratingFromFlutter(valoracion);

if (
  status === ReadingStatus.FINISHED &&
  (rating === null || rating <= 0)
) {
  return {
    ok: false,
    mensaje:
      'Los libros finalizados necesitan una valoración mayor que 0',
  };
}

await prisma.$transaction(async (tx) => {
  /*
   * El advisory lock también cubre el caso excepcional en que todavía no
   * exista Library. Después bloqueamos la fila real y consultamos el estado:
   * dos finalizaciones simultáneas no pueden decidir ambas que deben crear
   * ReadingCompletion.
   */
  const readingLockKey = `${user.id}:${book.id}`;
  await tx.$queryRaw`
    SELECT pg_advisory_xact_lock(
      hashtextextended(${readingLockKey}, 0)
    )::text
  `;
  await tx.$queryRaw`
    SELECT "id"
    FROM "Library"
    WHERE "userId" = ${user.id} AND "bookId" = ${book.id}
    FOR UPDATE
  `;

  const currentLibrary = await tx.library.findUnique({
    where: {
      userId_bookId: {
        userId: user.id,
        bookId: book.id,
      },
    },
  });

  const completionCount = await tx.readingCompletion.count({
    where: {
      userId: user.id,
      bookId: book.id,
    },
  });

  /*
   * Compatibilidad con versiones antiguas de Flutter: una petición LEYENDO
   * sobre un libro ya finalizado inicia una relectura, nunca una lectura
   * inicial que perdería el significado del historial.
   */
  const effectiveStatus =
    status === ReadingStatus.READING && completionCount > 0
      ? ReadingStatus.REREADING
      : status;

  const startsNewRereading =
    effectiveStatus === ReadingStatus.REREADING &&
    currentLibrary?.status !== ReadingStatus.REREADING;

  const statusDates =
    effectiveStatus === ReadingStatus.READING
      ? {
          startedAt: currentLibrary?.startedAt ?? now,
          finishedAt: null,
          pausedAt: null,
          pauseReason: null,
        }
      : effectiveStatus === ReadingStatus.PAUSED
        ? {
            startedAt: currentLibrary?.startedAt ?? now,
            finishedAt: null,
            pausedAt: now,
            pauseReason: motivoPausa?.trim() || null,
          }
        : effectiveStatus === ReadingStatus.REREADING
          ? {
              startedAt: startsNewRereading
                ? fechaInicioEditada ?? now
                : currentLibrary?.startedAt ?? fechaInicioEditada ?? now,
              finishedAt: null,
              pausedAt: null,
              pauseReason: null,
              lastProgress: null,
              currentPage: null,
              progressNote: null,
              progressUpdatedAt: null,
            }
          : effectiveStatus === ReadingStatus.FINISHED
            ? {
                startedAt:
                  fechaInicioEditada ?? currentLibrary?.startedAt ?? now,
                finishedAt:
                  currentLibrary?.status === ReadingStatus.FINISHED
                    ? fechaFinEditada ?? currentLibrary.finishedAt ?? now
                    : fechaFinEditada ?? now,
                pausedAt: null,
                pauseReason: null,
              }
            : effectiveStatus === ReadingStatus.ABANDONED
              ? {
                  finishedAt: now,
                  pausedAt: null,
                  pauseReason: null,
                }
              : {
                  startedAt: null,
                  finishedAt: null,
                  pausedAt: null,
                  pauseReason: null,
                  lastProgress: null,
                  currentPage: null,
                  progressNote: null,
                  progressUpdatedAt: null,
                };

  /*
   * FINISHED -> PENDING es una corrección del último cierre, no el borrado
   * indiscriminado de toda la historia de lectura.
   */
  if (
    currentLibrary?.status === ReadingStatus.FINISHED &&
    effectiveStatus === ReadingStatus.PENDING
  ) {
    const lastCompletion = await tx.readingCompletion.findFirst({
      where: {
        userId: user.id,
        bookId: book.id,
      },
      orderBy: [
        { finishedAt: 'desc' },
        { createdAt: 'desc' },
        { id: 'desc' },
      ],
    });

    if (lastCompletion) {
      await tx.readingCompletion.delete({
        where: { id: lastCompletion.id },
      });
    }

    const previousCompletion = await tx.readingCompletion.findFirst({
      where: {
        userId: user.id,
        bookId: book.id,
      },
      orderBy: [
        { finishedAt: 'desc' },
        { createdAt: 'desc' },
        { id: 'desc' },
      ],
    });

    if (previousCompletion) {
      if (previousCompletion.rating !== null) {
        await tx.review.upsert({
          where: {
            userId_bookId: {
              userId: user.id,
              bookId: book.id,
            },
          },
          update: {
            rating: previousCompletion.rating,
            review: previousCompletion.review,
            deletedAt: null,
          },
          create: {
            userId: user.id,
            bookId: book.id,
            rating: previousCompletion.rating,
            review: previousCompletion.review,
          },
        });
      } else {
        await tx.review.deleteMany({
          where: { userId: user.id, bookId: book.id },
        });
      }
    } else {
      await tx.review.deleteMany({
        where: { userId: user.id, bookId: book.id },
      });
    }
  }

  await tx.library.upsert({
    where: {
      userId_bookId: {
        userId: user.id,
        bookId: book.id,
      },
    },

    update: {
      status: effectiveStatus,
      ...(requestedFormat ? { readingFormat: requestedFormat } : {}),
      ...statusDates,
    },

    create: {
      userId: user.id,
      bookId: book.id,
      status: effectiveStatus,
      priority: Priority.MEDIUM,
      readingFormat: requestedFormat,
      ...statusDates,
    },
  }); 

  if (effectiveStatus === ReadingStatus.FINISHED) {
   const finalRating = rating as number;

    if (currentLibrary?.status !== ReadingStatus.FINISHED) {
      await tx.readingCompletion.create({
        data: {
          userId: user.id,
          bookId: book.id,
          startedAt: statusDates.startedAt,
          finishedAt: statusDates.finishedAt as Date,
          isReread: currentLibrary?.status === ReadingStatus.REREADING,
          rating: finalRating,
          review: reflexion?.trim() || null,
          readingFormat: requestedFormat ?? currentLibrary?.readingFormat,
        },
      });
    }

    await tx.review.upsert({
      where: {
        userId_bookId: {
          userId: user.id,
          bookId: book.id,
        },
      },

      update: {
        rating: finalRating,
        review: reflexion?.trim() || null,
      },

      create: {
        userId: user.id,
        bookId: book.id,
        rating: finalRating,
        review: reflexion?.trim() || null,
      },
    });

    return;
  }

  if (effectiveStatus === ReadingStatus.ABANDONED) {
    await tx.review.upsert({
      where: {
        userId_bookId: {
          userId: user.id,
          bookId: book.id,
        },
      },

      update: {
        rating: 0,
        review: null,
      },

      create: {
        userId: user.id,
        bookId: book.id,
        rating: 0,
        review: null,
      },
    });

    return;
  }

  /*
   * Pendiente, leyendo, pausado o relectura:
   * eliminamos cualquier valoración histórica.
   */
  if (
    !(
      currentLibrary?.status === ReadingStatus.FINISHED &&
      effectiveStatus === ReadingStatus.PENDING
    ) &&
    completionCount === 0
  ) {
    await tx.review.deleteMany({
      where: {
        userId: user.id,
        bookId: book.id,
      },
    });
  }
}, {
  isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
});
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
  const usuario = String(data.usuario || '').trim();

  const title = String(
    data.libro || data.titulo || data.title || '',
  )
    .trim()
    .replace(/\s+/g, ' ');
  const paginas = Number(data.paginas || data.totalPages || 0);

  if (paginas < 0 || !Number.isInteger(paginas)) {
    return { ok: false, mensaje: 'El número de páginas no es válido' };
  }

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

    await prisma.library.create({
      data: {
        userId: user.id,
        bookId: existingBook.id,
        status: ReadingStatus.PENDING,
        priority: priorityFromFlutter(data.prioridad),
        readingFormat: formatFromFlutter(data.formato),
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
    ? await buscarOCrearSaga(seriesName, genre.id)
    : null;


  const coverMatch = await findBestBookCover(
  title,
);

const automaticCover =
  coverMatch.safeToApply
    ? coverMatch.candidate
    : null;

if (automaticCover) {
  console.log(
    '🖼️ PORTADA ENCONTRADA:',
    automaticCover.title,
    automaticCover.coverUrl,
  );
} else {
  console.log(
    '⚠️ SIN PORTADA AUTOMÁTICA SEGURA:',
    title,
  );
}

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

          coverUrl:
            automaticCover?.coverUrl ?? null,

          isbn:
            automaticCover?.isbn ?? null,

          publicationYear:
            automaticCover?.publicationYear ?? null,
          totalPages: paginas > 0 ? paginas : null,
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
          readingFormat: formatFromFlutter(data.formato),
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

export async function quitarLibroPendientes(
  usuario: string,
  libro: string,
) {
  const nombreUsuario = usuario.trim();
  const tituloLibro = libro.trim();

  if (!nombreUsuario) {
    return {
      ok: false,
      codigo: 'FALTA_USUARIO',
      mensaje: 'Falta la usuaria',
    };
  }

  if (!tituloLibro) {
    return {
      ok: false,
      codigo: 'FALTA_LIBRO',
      mensaje: 'Falta el título del libro',
    };
  }

  const user = await prisma.user.findUnique({
    where: {
      name: nombreUsuario,
    },
  });

  if (!user) {
    return {
      ok: false,
      codigo: 'USUARIO_NO_ENCONTRADO',
      mensaje: 'Usuaria no encontrada',
    };
  }

  const book = await buscarLibroPorTitulo(tituloLibro);

  if (!book) {
    return {
      ok: false,
      codigo: 'LIBRO_NO_ENCONTRADO',
      mensaje: 'Libro no encontrado',
    };
  }

  const libraryItem = await prisma.library.findUnique({
    where: {
      userId_bookId: {
        userId: user.id,
        bookId: book.id,
      },
    },
  });

  if (!libraryItem) {
    return {
      ok: false,
      codigo: 'LIBRO_NO_EN_BIBLIOTECA',
      mensaje: 'Este libro no está en tu biblioteca',
    };
  }

  /*
   * Solo permitimos eliminar libros pendientes.
   * Nunca borramos desde aquí lecturas actuales o históricas.
   */
  if (libraryItem.status !== ReadingStatus.PENDING) {
    return {
      ok: false,
      codigo: 'LIBRO_NO_PENDIENTE',
      mensaje: 'Solo puedes quitar libros que estén en pendientes',
    };
  }

  const resultado = await prisma.$transaction(async (tx) => {
    /*
     * Eliminamos solamente la relación de esta usuaria.
     */
    await tx.library.delete({
      where: {
        userId_bookId: {
          userId: user.id,
          bookId: book.id,
        },
      },
    });

    /*
     * Comprobamos si alguna otra usuaria conserva el libro
     * en su biblioteca, sea cual sea su estado.
     */
    const relacionesRestantes = await tx.library.count({
      where: {
        bookId: book.id,
      },
    });

    if (relacionesRestantes > 0) {
      return {
        libroEliminadoDelCatalogo: false,
        relacionesRestantes,
      };
    }

    /*
     * Aunque no queden relaciones Library, protegemos cualquier
     * libro que forme parte del historial del club.
     */
    const [
      reviews,
      readings,
      clubvisionsGanadas,
      candidaturasClubvision,
      resultadosClubvision,
    ] = await Promise.all([
      tx.review.count({
        where: {
          bookId: book.id,
        },
      }),

      tx.reading.count({
        where: {
          bookId: book.id,
        },
      }),

      tx.clubvision.count({
        where: {
          winnerBookId: book.id,
        },
      }),

      tx.clubvisionCandidate.count({
        where: {
          bookId: book.id,
        },
      }),

      tx.clubvisionResult.count({
        where: {
          winnerBookId: book.id,
        },
      }),
    ]);

    const tieneHistorial =
      reviews > 0 ||
      readings > 0 ||
      clubvisionsGanadas > 0 ||
      candidaturasClubvision > 0 ||
      resultadosClubvision > 0;

    if (tieneHistorial) {
      return {
        libroEliminadoDelCatalogo: false,
        relacionesRestantes: 0,
      };
    }

    /*
     * Nadie lo tiene y nunca formó parte del historial:
     * podemos eliminar el Book de forma segura.
     */
    await tx.book.delete({
      where: {
        id: book.id,
      },
    });

    return {
      libroEliminadoDelCatalogo: true,
      relacionesRestantes: 0,
    };
  });

  return {
    ok: true,
    codigo: resultado.libroEliminadoDelCatalogo
      ? 'LIBRO_ELIMINADO_COMPLETAMENTE'
      : 'LIBRO_QUITADO_DE_PENDIENTES',

    mensaje: resultado.libroEliminadoDelCatalogo
      ? 'El libro se ha quitado de tus pendientes y del catálogo'
      : 'El libro se ha quitado de tus pendientes',

    eliminadoDelCatalogo:
      resultado.libroEliminadoDelCatalogo,
  };
}

export async function editarLibro(data: any) {
  const bookId = String(data.bookId || data.id || '').trim();

  const title = String(
    data.libro || data.titulo || data.title || '',
  )
    .trim()
    .replace(/\s+/g, ' ');
  const paginasFueEnviada =
    Object.prototype.hasOwnProperty.call(data, 'paginas') ||
    Object.prototype.hasOwnProperty.call(data, 'totalPages');
  const paginas = Number(data.paginas || data.totalPages || 0);

  if (paginasFueEnviada && (paginas < 0 || !Number.isInteger(paginas))) {
    return { ok: false, mensaje: 'El número de páginas no es válido' };
  }

  if (!bookId) {
    return {
      ok: false,
      codigo: 'FALTA_BOOK_ID',
      mensaje: 'Falta el identificador del libro',
    };
  }

  if (!title) {
    return {
      ok: false,
      codigo: 'FALTA_TITULO',
      mensaje: 'Falta el título del libro',
    };
  }

  const actual = await prisma.book.findFirst({
    where: {
      id: bookId,
      deletedAt: null,
    },
  });

  if (!actual) {
    return {
      ok: false,
      codigo: 'LIBRO_NO_ENCONTRADO',
      mensaje: 'Libro no encontrado',
    };
  }

  const tituloNormalizado = normalizarTitulo(title);

  const libros = await prisma.book.findMany({
    where: {
      deletedAt: null,
      id: {
        not: bookId,
      },
    },
    select: {
      id: true,
      title: true,
    },
  });

  const duplicado = libros.find(
    (book) => normalizarTitulo(book.title) === tituloNormalizado,
  );

if (duplicado) {
  return {
    ok: false,
    codigo: 'TITULO_DUPLICADO',
    mensaje: `Ya existe el libro "${duplicado.title}" en el catálogo`,
    libroExistente: {
      id: duplicado.id,
      titulo: duplicado.title,
    },
  };
}

  const genreName =
    String(data.genero || 'Sin género').trim() || 'Sin género';

  const seriesName = String(data.saga || '').trim();
  const seriesOrder = String(data.numSaga || '').trim();
  const standalone = boolFromFlutter(data.autoconclusivo);

  const goodreadsUrl = String(
    data.goodreads || data.goodreadsUrl || '',
  ).trim();

  const coverUrl = String(data.coverUrl || '').trim();

  const genre = await prisma.genre.upsert({
    where: {
      name: genreName,
    },
    update: {},
    create: {
      name: genreName,
    },
  });

  const series =
    !standalone && seriesName
      ? await buscarOCrearSaga(seriesName, genre.id, actual.seriesId)
      : null;

const actualizado = await prisma.book.update({
  where: {
    id: bookId,
  },
  data: {
    title,
    genreId: genre.id,
    standalone,

    seriesId: standalone
      ? null
      : series?.id ?? null,

    seriesOrder: standalone
      ? null
      : seriesOrder || null,

    goodreadsUrl:
      goodreadsUrl ||
      actual.goodreadsUrl ||
      buildGoodreadsSearchUrl(title),

    coverUrl:
      coverUrl ||
      actual.coverUrl ||
      null,

    totalPages: paginasFueEnviada
      ? paginas > 0
        ? paginas
        : null
      : actual.totalPages,
  },
});

  return {
    ok: true,
    codigo: 'LIBRO_ACTUALIZADO',
    mensaje: 'Libro actualizado correctamente',
    libro: {
      id: actualizado.id,
      titulo: actualizado.title,
      coverUrl: actualizado.coverUrl ?? '',
    },
  };
}
