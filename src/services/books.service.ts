import {
  Prisma,
  Priority,
  ReactionType,
  ReadingFormat,
  ReadingStatus,
} from '@prisma/client';
import { prisma } from '../prisma.js';
import {
  notifyLibroEmpezado,
  notifyLibroTerminado,
  notifyLibroNuevoBiblioteca,
} from './notifications.service.js';
import { findBestBookCover } from './book-cover.service.js';
import {
  ratingFromFlutter,
  ratingToFlutter,
} from '../utils/rating.utils.js';
import { getCurrentClubContext } from './club-context.service.js';
import {
  findBookByIdentity,
  findSimilarBooks,
  lockBookIdentity,
  resolveCanonicalBookId,
} from './book-identity.service.js';
import { validateReadingTransitionInput } from '../utils/reading-transition.utils.js';
import {
  descendingCursorFilter,
  pageFromRows,
  type PaginationRequest,
} from '../utils/cursor-pagination.js';
import { backgroundError, logger } from '../logging/logger.js';
import {
  normalizePriority,
  normalizeReadingFormat,
  normalizeReadingStatus,
} from '../validation/api-enums.js';
import { cached, invalidatePrefix } from '../utils/simple-cache.js';
import { syncAchievementsForUser } from './achievements.service.js';

const LIBRARY_TTL = 30_000; // 30 segundos

function invalidateUserLibraryCache(usuario: string) {
  invalidatePrefix(`libros:${usuario}`);
  invalidatePrefix(`finalizados:${usuario}`);
}

function invalidateAllLibraryCaches() {
  invalidatePrefix('libros:');
  invalidatePrefix('finalizados:');
}



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
  const priority = normalizePriority(value);
  if (priority === 'HIGH') return Priority.HIGH;
  if (priority === 'LOW') return Priority.LOW;
  return Priority.MEDIUM;
}

export function formatToFlutter(format: ReadingFormat | null) {
  if (format === ReadingFormat.PHYSICAL) return 'FISICO';
  if (format === ReadingFormat.DIGITAL) return 'DIGITAL';
  if (format === ReadingFormat.AUDIOBOOK) return 'AUDIOLIBRO';
  return '';
}

function formatFromFlutter(value: unknown): ReadingFormat | null {
  const format = normalizeReadingFormat(value);
  if (format === 'PHYSICAL') return ReadingFormat.PHYSICAL;
  if (format === 'DIGITAL') return ReadingFormat.DIGITAL;
  if (format === 'AUDIOBOOK') return ReadingFormat.AUDIOBOOK;
  return null;
}



function statusFromFlutter(value: string) {
  const status = normalizeReadingStatus(value);
  if (status === 'READING') return ReadingStatus.READING;
  if (status === 'PAUSED') return ReadingStatus.PAUSED;
  if (status === 'FINISHED') return ReadingStatus.FINISHED;
  if (status === 'ABANDONED') return ReadingStatus.ABANDONED;
  if (status === 'REREADING') return ReadingStatus.REREADING;
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

export function normalizeGoodreadsUrl(value: unknown) {
  return String(value ?? '')
    .replace(/\s+/g, '')
    .replace(/[,.;:!?]+$/g, '');
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
    const publicationStatus = equivalentes.some(
      (series) => series.publicationStatus === 'COMPLETED',
    )
      ? 'COMPLETED'
      : equivalentes.some((series) => series.publicationStatus === 'ONGOING')
        ? 'ONGOING'
        : 'UNKNOWN';

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
            publicationStatus,
          },
        });
      });
    }

    return {
      ...coincidencia,
      name: nombre,
      genreId,
      totalBooks: totalBooks > 0 ? totalBooks : null,
      publicationStatus,
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
  client: Pick<typeof prisma, 'book'> = prisma,
) {
  const tituloNormalizado = normalizarTitulo(titulo);

  if (!tituloNormalizado) {
    return null;
  }

  const libros = await client.book.findMany({
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
  return cached(`libros:${usuario}`, LIBRARY_TTL, () => _getLibros(usuario));
}

// ── Vista ClubReads: todos los usuarios, sin filtro de club ───────────────────
// Limitada a 600 entradas activas para evitar respuestas excesivas.
export async function getLibrosGlobal(usuario: string) {
  return cached(
    `libros-global:${usuario}`,
    LIBRARY_TTL,
    () => _getLibrosGlobal(usuario),
  );
}

async function _getLibrosGlobal(usuario: string) {
  const user = await prisma.user.findUnique({
    where: { name: usuario.trim() },
    select: { id: true },
  });

  const library = await prisma.library.findMany({
    where: {
      status: { not: ReadingStatus.FINISHED },
      book: { deletedAt: null },
    },
    include: {
      book: { include: { author: true, genre: true, series: true } },
      user: true,
    },
    orderBy: [{ book: { title: 'asc' } }, { user: { name: 'asc' } }],
  });

  return library.map((item) => ({
    bookId: item.book.id,
    usuario: item.user.name,
    libro: item.book.title,
    autor: item.book.author?.name ?? '',
    genero: item.book.genre.name,
    saga: item.book.series?.name ?? '',
    numSaga: item.book.seriesOrder ?? '',
    autoconclusivo: item.book.standalone ? 'Si' : 'No',
    prioridad: priorityToFlutter(item.priority),
    formato: formatToFlutter(item.readingFormat),
    leyendo: statusToFlutter(item.status),
    estado: statusToFlutter(item.status),
    valoracion: '',
    // fechaAlta = cuándo este usuario añadió el libro a su biblioteca.
    fechaAlta: item.createdAt.toISOString(),
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

export async function getLibrosFinalizadosTodosGlobal(usuario: string) {
  return cached(
    `finalizados-global:${usuario}`,
    LIBRARY_TTL,
    () => _getLibrosFinalizadosTodosGlobal(usuario),
  );
}

async function _getLibrosFinalizadosTodosGlobal(usuario: string) {
  const user = await prisma.user.findUnique({
    where: { name: usuario.trim() },
    select: { id: true },
  });

  const library = await prisma.library.findMany({
    where: {
      status: ReadingStatus.FINISHED,
      book: { deletedAt: null },
    },
    select: {
      userId: true,
      readingFormat: true,
      finishedAt: true,
      user: { select: { name: true, avatarUrl: true } },
      book: {
        select: {
          id: true,
          title: true,
          coverUrl: true,
          goodreadsUrl: true,
          totalPages: true,
          standalone: true,
          seriesOrder: true,
          createdAt: true,
          author: { select: { name: true } },
          genre: { select: { name: true } },
          series: { select: { name: true } },
          reviews: {
            where: { deletedAt: null },
            select: { userId: true, rating: true, review: true },
          },
        },
      },
    },
    orderBy: [
      { book: { title: 'asc' } },
      { user: { name: 'asc' } },
    ],
  });

  return library.map((item) => {
    const review = item.book.reviews.find((r) => r.userId === item.userId);
    return {
      bookId: item.book.id,
      usuario: item.user.name,
      libro: item.book.title,
      autor: item.book.author?.name ?? '',
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
        ? `${String(item.finishedAt.getMonth() + 1).padStart(2, '0')}/${item.finishedAt.getFullYear()}`
        : '',
    };
  });
}

async function _getLibros(usuario: string) {
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
          author: true,
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

  // Excluir libros pendientes importados de Goodreads/Bookmory
  // (para que los contadores "X lectores interesados" reflejen interés genuino)
  const pendingPairs = library
    .filter(item => item.status === ReadingStatus.PENDING)
    .map(item => ({ userId: item.userId, bookId: item.book.id }));

  const importedKeys: Set<string> = pendingPairs.length > 0
    ? new Set(
        (await prisma.importRowReceipt.findMany({
          where: { OR: pendingPairs },
          select: { userId: true, bookId: true },
        })).map(r => `${r.userId}:${r.bookId}`)
      )
    : new Set();

  const filteredLibrary = library.filter(
    item =>
      item.status !== ReadingStatus.PENDING ||
      !importedKeys.has(`${item.userId}:${item.book.id}`)
  );

  return filteredLibrary.map((item) => ({
    bookId: item.book.id,
    usuario: item.user.name,
    libro: item.book.title,
    autor: item.book.author?.name ?? '',
    genero: item.book.genre.name,
    saga: item.book.series?.name ?? '',
    numSaga: item.book.seriesOrder ?? '',
    autoconclusivo: item.book.standalone ? 'Si' : 'No',
    prioridad: priorityToFlutter(item.priority),
    formato: formatToFlutter(item.readingFormat),
    leyendo: statusToFlutter(item.status),
    estado: statusToFlutter(item.status),
    valoracion: '',
    startedAt: item.startedAt?.toISOString() ?? '',
    pausedAt: item.pausedAt?.toISOString() ?? '',
    pauseReason: item.pauseReason ?? '',
    yaLoTengo: item.userId === user?.id,
    // fechaAlta = cuándo este usuario añadió el libro a su biblioteca,
    // no cuándo el libro se creó en el catálogo. Esto evita que libros
    // recién llegados al catálogo (p.ej. por un import masivo) parezcan
    // "nuevos" para todos los miembros aunque llevasen tiempo en sus listas.
    fechaAlta: item.createdAt.toISOString(),
    // true cuando este registro llegó por importación (Goodreads, Bookmory…).
    // El cliente lo usa para excluir estos libros del orden "Añadidos recientemente"
    // y evitar que un import masivo inunde esa vista.
    isImported: importedKeys.has(`${item.userId}:${item.book.id}`),

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
          author: true,
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

  // Calcular qué entradas llegaron por importación (Goodreads/Bookmory)
  // para que el cliente pueda excluirlas del orden "Añadidos recientemente".
  const finalizadosPairs = library.map(item => ({
    userId: item.userId,
    bookId: item.book.id,
  }));
  const importedFinalizadosKeys: Set<string> = finalizadosPairs.length > 0
    ? new Set(
        (await prisma.importRowReceipt.findMany({
          where: { OR: finalizadosPairs },
          select: { userId: true, bookId: true },
        })).map(r => `${r.userId}:${r.bookId}`)
      )
    : new Set();

  return library.map((item) => {
    const review = item.book.reviews.find(
      (bookReview) => bookReview.userId === item.userId,
    );

    return {
      bookId: item.book.id,
      usuario: item.user.name,
      libro: item.book.title,
      autor: item.book.author?.name ?? '',
      genero: item.book.genre.name,
      saga: item.book.series?.name ?? '',
      numSaga: item.book.seriesOrder ?? '',
      autoconclusivo: item.book.standalone ? 'Si' : 'No',
      valoracion: ratingToFlutter(review?.rating),
      formato: formatToFlutter(item.readingFormat),
      // fechaAlta = cuándo este usuario terminó/añadió el libro a su biblioteca.
      fechaAlta: item.createdAt.toISOString(),
      resena: review?.review ?? '',
      review: review?.review ?? '',
      goodreads: item.book.goodreadsUrl ?? '',
      fecha: item.finishedAt ?? '',
      coverUrl: item.book.coverUrl ?? '',
      avatarUrl: item.user.avatarUrl ?? '',
      paginas: item.book.totalPages,
      yaLoTengo: item.userId === user?.id,
      // true cuando este registro llegó por importación.
      isImported: importedFinalizadosKeys.has(`${item.userId}:${item.book.id}`),
      mes: item.finishedAt
        ? `${String(item.finishedAt.getMonth() + 1).padStart(
            2,
            '0',
          )}/${item.finishedAt.getFullYear()}`
        : '',
    };
  });
}


export async function getLibrosFinalizadosTodos(usuario: string) {
  return cached(
    `finalizados:${usuario}`,
    LIBRARY_TTL,
    () => _getLibrosFinalizadosTodos(usuario),
  );
}

async function _getLibrosFinalizadosTodos(usuario: string) {
  const { club, user } = await getCurrentClubContext(usuario.trim());

  const library = await prisma.library.findMany({
    where: {
      user: { clubMemberships: { some: { clubId: club.id } } },
      status: ReadingStatus.FINISHED,
    },
    select: {
      userId: true,
      createdAt: true,   // cuándo el usuario añadió el libro a su biblioteca
      readingFormat: true,
      finishedAt: true,
      user: { select: { name: true, avatarUrl: true } },
      book: {
        select: {
          id: true,
          title: true,
          coverUrl: true,
          goodreadsUrl: true,
          totalPages: true,
          standalone: true,
          seriesOrder: true,
          author: { select: { name: true } },
          genre: { select: { name: true } },
          series: { select: { name: true } },
          reviews: {
            where: { deletedAt: null },
            select: { userId: true, rating: true, review: true },
          },
        },
      },
    },
    orderBy: [
      { book: { title: 'asc' } },
      { user: { name: 'asc' } },
    ],
  });

  // Detectar qué entradas llegaron por importación (Goodreads/Bookmory)
  const finalizadosPairs = library.map(item => ({
    userId: item.userId,
    bookId: item.book.id,
  }));
  const importedKeys: Set<string> = finalizadosPairs.length > 0
    ? new Set(
        (await prisma.importRowReceipt.findMany({
          where: { OR: finalizadosPairs },
          select: { userId: true, bookId: true },
        })).map(r => `${r.userId}:${r.bookId}`)
      )
    : new Set();

  return library.map((item) => {
    const review = item.book.reviews.find((r) => r.userId === item.userId);
    return {
      bookId: item.book.id,
      usuario: item.user.name,
      libro: item.book.title,
      autor: item.book.author?.name ?? '',
      genero: item.book.genre.name,
      saga: item.book.series?.name ?? '',
      numSaga: item.book.seriesOrder ?? '',
      autoconclusivo: item.book.standalone ? 'Si' : 'No',
      valoracion: ratingToFlutter(review?.rating),
      formato: formatToFlutter(item.readingFormat),
      // fechaAlta = Library.createdAt: cuándo el usuario añadió el libro,
      // no cuándo el libro fue catalogado (book.createdAt). Evita que imports
      // masivos con libros recién creados en el catálogo inunden "Más recientes".
      fechaAlta: item.createdAt.toISOString(),
      resena: review?.review ?? '',
      review: review?.review ?? '',
      goodreads: item.book.goodreadsUrl ?? '',
      fecha: item.finishedAt ?? '',
      coverUrl: item.book.coverUrl ?? '',
      avatarUrl: item.user.avatarUrl ?? '',
      paginas: item.book.totalPages,
      yaLoTengo: item.userId === user?.id,
      // true si este registro llegó por importación; el cliente lo usa
      // para excluir estos libros del orden "Más recientes".
      isImported: importedKeys.has(`${item.userId}:${item.book.id}`),
      mes: item.finishedAt
        ? `${String(item.finishedAt.getMonth() + 1).padStart(2, '0')}/${item.finishedAt.getFullYear()}`
        : '',
    };
  });
}

export async function getLibrosFinalizadosPage(
  usuario: string,
  pagination: PaginationRequest,
) {
  const { club, user } = await getCurrentClubContext(usuario);
  const rows = await prisma.library.findMany({
    where: {
      user: { clubMemberships: { some: { clubId: club.id } } },
      status: ReadingStatus.FINISHED,
      finishedAt: { not: null },
      ...descendingCursorFilter('finishedAt', pagination.cursor),
    },
    select: {
      id: true,
      userId: true,
      readingFormat: true,
      finishedAt: true,
      user: { select: { name: true, avatarUrl: true } },
      book: {
        select: {
          id: true,
          title: true,
          seriesOrder: true,
          standalone: true,
          goodreadsUrl: true,
          coverUrl: true,
          totalPages: true,
          createdAt: true,
          author: { select: { name: true } },
          genre: { select: { name: true } },
          series: { select: { name: true } },
          reviews: {
            where: { deletedAt: null },
            select: { userId: true, rating: true, review: true },
          },
        },
      },
    },
    orderBy: [{ finishedAt: 'desc' }, { id: 'desc' }],
    take: pagination.limit + 1,
  });
  const page = pageFromRows(rows, pagination.limit, (row) => ({
    value: row.finishedAt!.toISOString(),
    id: row.id,
  }));
  return {
    ...page,
    items: page.items.map((item) => {
      const review = item.book.reviews.find(({ userId }) => userId === item.userId);
      return {
        bookId: item.book.id,
        usuario: item.user.name,
        libro: item.book.title,
        autor: item.book.author?.name ?? '',
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
          ? `${String(item.finishedAt.getMonth() + 1).padStart(2, '0')}/${item.finishedAt.getFullYear()}`
          : '',
      };
    }),
  };
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

  // El cliente puede enviar el bookId (cuid) o el título del libro.
  // Intentamos primero por ID para evitar colisiones con títulos duplicados.
  const looksLikeId = /^c[a-z0-9]{20,}$/.test(libro.trim());
  const book = looksLikeId
    ? await prisma.book.findUnique({ where: { id: libro.trim(), deletedAt: null } })
    : await buscarLibroPorTitulo(libro);

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

  invalidateUserLibraryCache(usuario);

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

  invalidateUserLibraryCache(usuario);

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
  runtime: {
    prismaClient?: typeof prisma;
    now?: () => Date;
  } = {},
) {
  const db = runtime.prismaClient ?? prisma;
  const now = runtime.now?.() ?? new Date();
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

  const lectura = await db.library.findFirst({
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
  let paginasLeidas = 0; // delta de páginas leídas en esta actualización
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
    // Páginas avanzadas respecto a la última actualización (mínimo 0)
    paginasLeidas = Math.max(0, pagina - (lectura.currentPage ?? 0));
  }

  const today = now.toISOString().slice(0, 10);

  // Transacción principal: actualizar progreso del libro
  await db.$transaction([
    ...(lectura.progressNote !== (comentario.trim() || null)
      ? [
          db.progressReaction.deleteMany({
            where: { libraryId: lectura.id },
          }),
        ]
      : []),
    db.library.update({
      where: { id: lectura.id },
      data: {
        lastProgress: porcentaje,
        currentPage: pagina,
        progressNote: comentario.trim() || null,
        progressUpdatedAt: now,
      },
    }),
    ...(totalFueEnviado
      ? [
          db.book.update({
            where: { id: lectura.bookId },
            data: { totalPages: totalEnviado },
          }),
        ]
      : []),
  ]);

  // Registrar sesión de lectura diaria (best-effort: no falla el progreso si la tabla no existe)
  if (paginasLeidas > 0) {
    try {
      await db.readingSession.upsert({
        where: { userId_date: { userId: lectura.userId, date: today } },
        create: { userId: lectura.userId, date: today, pagesRead: paginasLeidas },
        update: { pagesRead: { increment: paginasLeidas } },
      });
    } catch {
      // Tabla ReadingSession aún no migrada — se ignora sin afectar el progreso
    }
  }

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
  runtime: {
    client?: typeof prisma;
    notifyStarted?: typeof notifyLibroEmpezado;
    notifyFinished?: typeof notifyLibroTerminado;
  } = {},
) {
  const client = runtime.client ?? prisma;
  const notifyStarted = runtime.notifyStarted ?? notifyLibroEmpezado;
  const notifyFinished = runtime.notifyFinished ?? notifyLibroTerminado;
  const user = await client.user.findUnique({
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

  const book = await buscarLibroPorTitulo(libro, client);

  if (!book) {
    return {
      ok: false,
      mensaje: 'Libro no encontrado',
    };
  }

  const status = statusFromFlutter(estado);
  const requestedFormat = formatFromFlutter(formato);
  const now = new Date();
  const transition = validateReadingTransitionInput({
    status,
    valoracion,
    fechaInicio,
    fechaFin,
    now,
  });
  if (!transition.ok) return transition;
  const fechaInicioEditada = transition.startDate;
  const fechaFinEditada = transition.endDate;
  const rating = transition.rating;

let startedReading = false;
let finishedNotificationClubIds: string[] = [];

await client.$transaction(async (tx) => {
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

  startedReading =
    effectiveStatus === ReadingStatus.READING &&
    currentLibrary?.status !== ReadingStatus.READING;

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
      const memberships = await tx.clubMember.findMany({
        where: { userId: user.id },
        select: { clubId: true },
      });
      finishedNotificationClubIds = memberships.map(({ clubId }) => clubId);
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
  maxWait: 5_000,
  timeout: 15_000,
});

  invalidateUserLibraryCache(usuario);

for (const clubId of finishedNotificationClubIds) {
  void notifyFinished({
    clubId,
    lectoraNombre: user.name,
    lectoraUserId: user.id,
    bookTitle: book.title,
    bookId: book.id,
  }).catch(backgroundError('book_finished_notification_failed'));
}

// Sincronizar logros al terminar un libro
if (finishedNotificationClubIds.length > 0) {
  for (const clubId of finishedNotificationClubIds) {
    void syncAchievementsForUser(user.id, user.name, clubId).catch(() => {});
  }
}

if (startedReading) {
  const memberships = await client.clubMember.findMany({
    where: { userId: user.id },
    select: { clubId: true },
  });
  for (const membership of memberships) {
    void notifyStarted({
      clubId: membership.clubId,
      lectoraNombre: user.name,
      lectoraUserId: user.id,
      bookTitle: book.title,
      bookId: book.id,
    }).catch(backgroundError('book_started_notification_failed'));
  }
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

  // Sincronizar logros al valorar un libro
  const memberships = await prisma.clubMember.findMany({
    where: { userId: user.id },
    select: { clubId: true },
  });
  for (const { clubId } of memberships) {
    void syncAchievementsForUser(user.id, user.name, clubId).catch(() => {});
  }

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
  const suppliedAuthorName = String(
    data.autor || data.author || '',
  ).trim().replace(/\s+/g, ' ');
  const suppliedIsbn = String(data.isbn || '').trim();
  const suppliedCoverUrl = String(
    data.coverUrl || data.portadaUrl || data.portada || '',
  ).trim();
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
  const existingBook = await findBookByIdentity(prisma, {
    title,
    authorName: suppliedAuthorName,
    isbn: suppliedIsbn,
  });

  /*
   * Si el cliente no ha confirmado explícitamente que quiere crear un libro nuevo,
   * buscamos posibles duplicados por similitud de título antes de crear.
   * El cliente confirma pasando `confirmarNuevo: true`.
   */
  if (!existingBook && !data.confirmarNuevo) {
    const similares = await findSimilarBooks(prisma, title, {
      authorName: suppliedAuthorName || null,
      limit: 3,
    });
    if (similares.length > 0) {
      return {
        ok: false,
        codigo: 'POSIBLES_DUPLICADOS',
        mensaje: 'Ya existen libros similares. ¿Es alguno de estos el que buscas?',
        candidatos: similares,
      };
    }
  }

  if (existingBook) {
    if (!existingBook.coverUrl?.trim() && suppliedCoverUrl) {
      await prisma.book.update({
        where: { id: existingBook.id },
        data: { coverUrl: suppliedCoverUrl },
      });
      existingBook.coverUrl = suppliedCoverUrl;
    }

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

    await prisma.library.upsert({
      where: { userId_bookId: { userId: user.id, bookId: existingBook.id } },
      update: {},
      create: {
        userId: user.id,
        bookId: existingBook.id,
        status: ReadingStatus.PENDING,
        priority: priorityFromFlutter(data.prioridad),
        readingFormat: formatFromFlutter(data.formato),
      },
    });

    // Notificar libro nuevo en biblioteca
    const memberships2 = await prisma.clubMember.findMany({
      where: { userId: user.id },
      select: { clubId: true },
    });
    for (const m of memberships2) {
      notifyLibroNuevoBiblioteca({
        clubId: m.clubId,
        autoraNombre: user.name,
        autoraUserId: user.id,
        libros: [{ id: existingBook.id, title: existingBook.title }],
      }).catch(backgroundError('library_addition_notification_failed'));
    }

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

  const goodreadsUrl = normalizeGoodreadsUrl(
    data.goodreads || data.goodreadsUrl || '',
  );

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

const automaticAuthorName =
  !suppliedAuthorName && automaticCover?.authors.length === 1
    ? automaticCover.authors[0].trim()
    : '';

logger.info({
  event: 'automatic_cover_lookup',
  outcome: automaticCover ? 'matched' : 'no_safe_match',
}, 'automatic cover lookup completed');

  /*
   * Libro y biblioteca se crean en la misma transacción.
   */
  const result = await prisma.$transaction(
    async (tx) => {
      const resolvedAuthorName = suppliedAuthorName || automaticAuthorName;
      const automaticAuthor = resolvedAuthorName
        ? (
            await tx.author.findFirst({
              where: {
                name: {
                  equals: resolvedAuthorName,
                  mode: 'insensitive',
                },
              },
            })
          ) ?? await tx.author.create({
            data: { name: resolvedAuthorName },
          })
        : null;

      const identity = {
        title,
        authorName: automaticAuthor?.name ?? resolvedAuthorName,
        isbn: suppliedIsbn || automaticCover?.isbn,
      };
      await lockBookIdentity(tx, identity);
      const concurrentBook = await findBookByIdentity(tx, identity);
      if (concurrentBook) {
        const existingLibrary = await tx.library.findUnique({
          where: { userId_bookId: { userId: user.id, bookId: concurrentBook.id } },
          select: { id: true },
        });
        await tx.library.upsert({
          where: { userId_bookId: { userId: user.id, bookId: concurrentBook.id } },
          update: {},
          create: {
            userId: user.id,
            bookId: concurrentBook.id,
            status: ReadingStatus.PENDING,
            priority: priorityFromFlutter(data.prioridad),
            readingFormat: formatFromFlutter(data.formato),
          },
        });
        return { book: concurrentBook, created: false, alreadyInLibrary: Boolean(existingLibrary) };
      }

      const createdBook = await tx.book.create({
        data: {
          title,
          authorId: automaticAuthor?.id ?? null,
          genreId: genre.id,
          seriesId: series?.id ?? null,
          seriesOrder: seriesOrder || null,
          standalone,

          goodreadsUrl:
            goodreadsUrl ||
            buildGoodreadsSearchUrl(title),

          createdById: user.id,

          coverUrl:
            suppliedCoverUrl || automaticCover?.coverUrl || null,

          isbn: suppliedIsbn || automaticCover?.isbn || null,

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

      return { book: createdBook, created: true, alreadyInLibrary: false };
    },
  );

  invalidateUserLibraryCache(usuario);

  const book = result.book;

  return {
    ok: true,
    creado: result.created,
    codigo: result.alreadyInLibrary
      ? 'LIBRO_YA_EN_BIBLIOTECA'
      : result.created ? 'LIBRO_CREADO' : 'LIBRO_EXISTENTE_ANADIDO',

    mensaje:
      result.alreadyInLibrary
        ? 'Este libro ya está en tu biblioteca'
        : result.created
          ? 'Libro creado y añadido a tu biblioteca'
          : 'El libro ya existía y se ha añadido a tu biblioteca',

    libro: {
      id: book.id,
      titulo: book.title,
    },
  };
}

export async function quitarLibroPendientes(
  usuario: string,
  libro: string,
  bookId?: string,
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

  if (!tituloLibro && !bookId) {
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

  // Si el cliente envía bookId, lo usamos directamente para evitar la búsqueda
  // por título (que falla cuando existen libros con el mismo nombre).
  const book = bookId
    ? await prisma.book.findUnique({ where: { id: bookId, deletedAt: null } })
    : await buscarLibroPorTitulo(tituloLibro);

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

  invalidateUserLibraryCache(nombreUsuario);

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
  const requestedBookId = String(data.bookId || data.id || '').trim();

  const title = String(
    data.libro || data.titulo || data.title || '',
  )
    .trim()
    .replace(/\s+/g, ' ');
  const suppliedAuthorName = String(
    data.autor || data.author || '',
  ).trim().replace(/\s+/g, ' ');
  const paginasFueEnviada =
    Object.prototype.hasOwnProperty.call(data, 'paginas') ||
    Object.prototype.hasOwnProperty.call(data, 'totalPages');
  const paginas = Number(data.paginas || data.totalPages || 0);
  const isbnFueEnviado = Object.prototype.hasOwnProperty.call(data, 'isbn');
  const isbn = String(data.isbn || '').trim() || null;

  if (paginasFueEnviada && (paginas < 0 || !Number.isInteger(paginas))) {
    return { ok: false, mensaje: 'El número de páginas no es válido' };
  }

  if (!requestedBookId) {
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

  const bookId = await resolveCanonicalBookId(prisma, requestedBookId);
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

  const effectiveAuthorName = suppliedAuthorName || (
    await prisma.author.findUnique({ where: { id: actual.authorId ?? '' }, select: { name: true } })
  )?.name || '';
  const duplicado = await findBookByIdentity(prisma, {
    title,
    authorName: effectiveAuthorName,
    isbn: String(data.isbn || actual.isbn || ''),
    excludeBookId: bookId,
  });

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

  const goodreadsUrl = normalizeGoodreadsUrl(
    data.goodreads || data.goodreadsUrl || '',
  );

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

const suppliedAuthor = suppliedAuthorName
  ? (
      await prisma.author.findFirst({
        where: {
          name: {
            equals: suppliedAuthorName,
            mode: 'insensitive',
          },
        },
      })
    ) ?? await prisma.author.create({
      data: { name: suppliedAuthorName },
    })
  : null;

const editResult = await prisma.$transaction(async (tx) => {
  const finalAuthorName = suppliedAuthor?.name || effectiveAuthorName;
  const identity = { title, authorName: finalAuthorName, isbn: isbnFueEnviado ? isbn : actual.isbn };
  await lockBookIdentity(tx, identity);
  const concurrentDuplicate = await findBookByIdentity(tx, {
    ...identity,
    excludeBookId: bookId,
  });
  if (concurrentDuplicate) return { duplicate: concurrentDuplicate, updated: null };
  const updated = await tx.book.update({
    where: { id: bookId },
    data: {
    title,
    authorId: suppliedAuthor?.id ?? actual.authorId,
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

    isbn: isbnFueEnviado ? isbn : actual.isbn,

    totalPages: paginasFueEnviada
      ? paginas > 0
        ? paginas
        : null
      : actual.totalPages,
    },
  });
  return { duplicate: null, updated };
});

if (editResult.duplicate) {
  return {
    ok: false,
    codigo: 'LIBRO_DUPLICADO',
    mensaje: `Ya existe el libro "${editResult.duplicate.title}" en el catálogo`,
    libroExistente: { id: editResult.duplicate.id, titulo: editResult.duplicate.title },
  };
}
const actualizado = editResult.updated!;
invalidateAllLibraryCaches();

  return {
    ok: true,
    codigo: 'LIBRO_ACTUALIZADO',
    mensaje: 'Libro actualizado correctamente',
    libro: {
      id: actualizado.id,
      titulo: actualizado.title,
      coverUrl: actualizado.coverUrl ?? '',
      goodreadsUrl: actualizado.goodreadsUrl ?? '',
    },
  };
}
