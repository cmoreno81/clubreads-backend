import { prisma } from '../prisma.js';

/**
 * Devuelve todos los libros de la biblioteca personal del usuario
 * en formato listo para exportar (CSV / Excel en el cliente).
 *
 * Incluye:
 *   - Datos del libro (título, autor, género, saga, páginas, goodreads)
 *   - Estado y preferencias del registro (formato, prioridad, fechas)
 *   - Valoración y reseña (desde Review)
 *   - Fecha de finalización (Library.finishedAt)
 */
export async function exportBiblioteca(userName: string) {
  const user = await prisma.user.findUnique({
    where: { name: userName.trim() },
    select: { id: true },
  });

  if (!user) return { ok: false, mensaje: 'Usuaria no encontrada' };

  const entries = await prisma.library.findMany({
    where: { userId: user.id },
    orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    select: {
      status: true,
      priority: true,
      readingFormat: true,
      startedAt: true,
      finishedAt: true,
      isFavorite: true,
      currentPage: true,
      createdAt: true,
      book: {
        select: {
          title: true,
          totalPages: true,
          goodreadsUrl: true,
          standalone: true,
          seriesOrder: true,
          author: { select: { name: true } },
          genre: { select: { name: true } },
          series: { select: { name: true } },
          reviews: {
            where: { userId: user.id, deletedAt: null },
            select: { rating: true, review: true },
            take: 1,
          },
        },
      },
    },
  });

  const statusLabel: Record<string, string> = {
    PENDING: 'En mi estantería',
    READING: 'Leyendo',
    PAUSED: 'Necesito un respiro',
    ABANDONED: 'No era para mí',
    FINISHED: 'Historia terminada',
    REREADING: 'Otra vuelta',
  };

  const priorityLabel: Record<string, string> = {
    HIGH: 'Alta',
    MEDIUM: 'Media',
    LOW: 'Baja',
  };

  const formatLabel: Record<string, string> = {
    PHYSICAL: 'Físico',
    DIGITAL: 'Digital',
    AUDIO: 'Audiolibro',
  };

  const fmt = (d: Date | null | undefined) =>
    d ? d.toISOString().split('T')[0] : '';

  const libros = entries.map((e) => {
    const bookReview = e.book.reviews[0] as { rating: number; review: string | null } | undefined;

    return {
      titulo: e.book.title,
      autor: e.book.author?.name ?? '',
      genero: e.book.genre?.name ?? '',
      saga: e.book.series?.name ?? '',
      numSaga: e.book.seriesOrder ?? '',
      autoconclusivo: e.book.standalone ? 'Sí' : 'No',
      estado: statusLabel[e.status] ?? e.status,
      formato: e.readingFormat ? (formatLabel[e.readingFormat] ?? e.readingFormat) : '',
      prioridad: priorityLabel[e.priority] ?? e.priority,
      paginas: e.book.totalPages ?? '',
      paginaActual: e.currentPage ?? '',
      favorito: e.isFavorite ? 'Sí' : 'No',
      fechaInicio: fmt(e.startedAt),
      fechaFin: fmt(e.finishedAt),
      valoracion: bookReview?.rating != null ? String(bookReview.rating) : '',
      resena: bookReview?.review ?? '',
      goodreads: e.book.goodreadsUrl ?? '',
      fechaAnadido: fmt(e.createdAt),
    };
  });

  return { ok: true, libros };
}
