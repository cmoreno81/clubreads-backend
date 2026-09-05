import { prisma } from '../prisma.js';

function statusToFlutter(status: string) {
  if (status === 'READING') return 'LEYENDO';
  if (status === 'PAUSED') return 'PAUSADO';
  if (status === 'FINISHED') return 'FINALIZADO';
  if (status === 'ABANDONED') return 'ABANDONADO';
  if (status === 'REREADING') return 'RELECTURA';
  return 'PENDIENTE';
}

function numeroSagaValor(value: string | null) {
  const parsed = Number.parseFloat((value ?? '').replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : Number.MAX_SAFE_INTEGER;
}

/**
 * Devuelve el resto de libros de la saga a la que pertenece `bookId` (todos
 * los que ya existen en el catálogo, los haya añadido quien sea), con el
 * estado de la usuaria actual para cada uno ('NO_ANADIDO' si todavía no lo
 * tiene). Si el libro no pertenece a ninguna saga, o es el único volumen
 * conocido de la suya, devuelve una lista vacía: no tiene sentido sugerir
 * nada todavía.
 */
export async function getSeriesVolumesForBook(bookId: string, usuario: string) {
  const user = await prisma.user.findUnique({ where: { name: usuario.trim() } });
  if (!user) return { ok: false as const, mensaje: 'Usuaria no encontrada' };
  if (!bookId?.trim()) return { ok: false as const, mensaje: 'Falta el bookId' };

  const book = await prisma.book.findUnique({
    where: { id: bookId },
    select: { seriesId: true },
  });
  if (!book?.seriesId) return { ok: true as const, volumenes: [] };

  const siblings = await prisma.book.findMany({
    where: { seriesId: book.seriesId, deletedAt: null, id: { not: bookId } },
    select: { id: true, title: true, seriesOrder: true, coverUrl: true },
  });
  if (siblings.length === 0) return { ok: true as const, volumenes: [] };

  const libraryRows = await prisma.library.findMany({
    where: { userId: user.id, bookId: { in: siblings.map((sibling) => sibling.id) } },
    select: { bookId: true, status: true },
  });
  const statusByBookId = new Map(libraryRows.map((row) => [row.bookId, row.status]));

  const volumenes = siblings
    .map((sibling) => ({
      bookId: sibling.id,
      titulo: sibling.title,
      numero: sibling.seriesOrder ?? '',
      coverUrl: sibling.coverUrl ?? '',
      estado: statusByBookId.has(sibling.id)
        ? statusToFlutter(statusByBookId.get(sibling.id)!)
        : 'NO_ANADIDO',
    }))
    .sort((a, b) => {
      const byOrder = numeroSagaValor(a.numero) - numeroSagaValor(b.numero);
      return byOrder !== 0 ? byOrder : a.titulo.localeCompare(b.titulo, 'es');
    });

  return { ok: true as const, volumenes };
}
