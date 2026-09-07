import { ReadingStatus } from '@prisma/client';
import { prisma } from '../prisma.js';
import { getCurrentClubContext } from './club-context.service.js';
import { formatToFlutter } from './books.service.js';
import { ratingToFlutter } from '../utils/rating.utils.js';

/**
 * Devuelve los datos de un libro concreto para el usuario actual:
 * su entrada en Library (no finalizado) y sus ReadingCompletions,
 * equivalente a lo que getLibrosData() filtra por bookId pero
 * sin cargar toda la biblioteca del club.
 */
export async function getLibroPorId(bookId: string, usuario: string, global = false) {
  const { club, user } = await getCurrentClubContext(usuario.trim());

  if (!user) return { ok: false, mensaje: 'Usuaria no encontrada' };
  if (!bookId?.trim()) return { ok: false, mensaje: 'Falta el bookId' };

  // Filtro de club: cuando global=true se devuelven datos de todos los clubes
  // y cuentas personales; cuando false (por defecto) solo el club activo.
  const clubFilter = global
    ? {}
    : { user: { clubMemberships: { some: { clubId: club.id } } } };

  const [libraryEntries, completions, book] = await Promise.all([
    // Entradas activas en Library (no finalizadas)
    prisma.library.findMany({
      where: {
        bookId,
        ...clubFilter,
        status: { not: ReadingStatus.FINISHED },
      },
      select: {
        userId: true,
        status: true,
        priority: true,
        readingFormat: true,
        startedAt: true,
        pausedAt: true,
        pauseReason: true,
        lastProgress: true,
        currentPage: true,
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
          },
        },
        user: { select: { name: true, avatarUrl: true, activeClubId: true } },
      },
    }),

    // Finalizaciones del libro
    prisma.library.findMany({
      where: {
        bookId,
        ...clubFilter,
        status: ReadingStatus.FINISHED,
      },
      select: {
        userId: true,
        readingFormat: true,
        finishedAt: true,
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
        user: { select: { name: true, avatarUrl: true, activeClubId: true } },
      },
    }),

    // Info básica del libro (por si no está en ninguna biblioteca)
    prisma.book.findUnique({
      where: { id: bookId },
      select: {
        id: true,
        title: true,
        coverUrl: true,
        goodreadsUrl: true,
        totalPages: true,
        standalone: true,
        seriesOrder: true,
        createdAt: true,
        deletedAt: true,
        author: { select: { name: true } },
        genre: { select: { name: true } },
        series: { select: { name: true } },
      },
    }),
  ]);

  if (!book || book.deletedAt) {
    return { ok: false, mensaje: 'Libro no encontrado' };
  }

  const priorityToFlutter = (p: string) =>
    p === 'HIGH' ? 'ALTA' : p === 'LOW' ? 'BAJA' : 'MEDIA';
  const statusToFlutter = (s: string) => {
    if (s === 'READING') return 'LEYENDO';
    if (s === 'PAUSED') return 'PAUSADO';
    if (s === 'ABANDONED') return 'ABANDONADO';
    if (s === 'REREADING') return 'RELECTURA';
    return 'PENDIENTE';
  };

  // Igual que en la vista ClubReads: mezclamos lectoras de todos los clubes,
  // pero solo revelamos nombre y foto de quienes comparten club con quien
  // pregunta. El resto se anonimiza ya desde el backend, nunca solo en el
  // cliente, para que ninguna versión de la app filtre con quién lee gente
  // de otros clubes.
  const libros = libraryEntries.map((item) => {
    const mismoClub = Boolean(
      user.activeClubId && item.user.activeClubId === user.activeClubId,
    );
    return {
      bookId: item.book.id,
      usuario: mismoClub ? item.user.name : 'Lectora de otro club',
      mismoClub,
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
      fechaAlta: item.book.createdAt.toISOString(),
      startedAt: item.startedAt?.toISOString() ?? '',
      pausedAt: item.pausedAt?.toISOString() ?? '',
      pauseReason: item.pauseReason ?? '',
      yaLoTengo: item.userId === user.id,
      goodreads: item.book.goodreadsUrl ?? '',
      coverUrl: item.book.coverUrl ?? '',
      avatarUrl: mismoClub ? item.user.avatarUrl ?? '' : '',
      paginas: item.book.totalPages,
    };
  });

  const finalizados = completions.map((item) => {
    const review = item.book.reviews.find((r) => r.userId === item.userId);
    const mismoClub = Boolean(
      user.activeClubId && item.user.activeClubId === user.activeClubId,
    );
    return {
      bookId: item.book.id,
      usuario: mismoClub ? item.user.name : 'Lectora de otro club',
      mismoClub,
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
      avatarUrl: mismoClub ? item.user.avatarUrl ?? '' : '',
      paginas: item.book.totalPages,
      yaLoTengo: item.userId === user.id,
      mes: item.finishedAt
        ? `${String(item.finishedAt.getMonth() + 1).padStart(2, '0')}/${item.finishedAt.getFullYear()}`
        : '',
    };
  });

  return {
    ok: true,
    libro: {
      id: book.id,
      titulo: book.title,
      autor: book.author?.name ?? '',
      genero: book.genre?.name ?? '',
      coverUrl: book.coverUrl ?? '',
      goodreads: book.goodreadsUrl ?? '',
      paginas: book.totalPages,
      // Saga real del catálogo: necesaria para precargar el formulario de
      // edición cuando nadie del club tiene aún este libro en su biblioteca
      // (si no, el formulario no tiene de dónde sacarla y al guardar lo
      // marca como autoconclusivo, borrando su saga para todo el mundo).
      saga: book.series?.name ?? '',
      numSaga: book.seriesOrder ?? '',
      autoconclusivo: book.standalone ? 'Si' : 'No',
    },
    libros,
    finalizados,
  };
}