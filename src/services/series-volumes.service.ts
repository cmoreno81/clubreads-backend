import { prisma } from '../prisma.js';
import { datosNumeroSaga, numeroSaga } from './perfil.service.js';

function statusToFlutter(status: string) {
  if (status === 'READING') return 'LEYENDO';
  if (status === 'PAUSED') return 'PAUSADO';
  if (status === 'FINISHED') return 'FINALIZADO';
  if (status === 'ABANDONED') return 'ABANDONADO';
  if (status === 'REREADING') return 'RELECTURA';
  return 'PENDIENTE';
}

/**
 * Devuelve el resto de libros de la saga a la que pertenece `bookId` (todos
 * los que ya existen en el catálogo, los haya añadido quien sea), con el
 * estado de la usuaria actual para cada uno ('NO_ANADIDO' si todavía no lo
 * tiene, o 'LEIDO_EXTERNO'/'OMITIDO' si lo marcó así en la pestaña Sagas sin
 * tenerlo en su biblioteca). Si el libro no pertenece a ninguna saga, o es
 * el único volumen conocido de la suya, devuelve una lista vacía: no tiene
 * sentido sugerir nada todavía.
 */
export async function getSeriesVolumesForBook(bookId: string, usuario: string) {
  if (!bookId?.trim()) return { ok: false as const, mensaje: 'Falta el bookId' };

  const [user, book] = await Promise.all([
    prisma.user.findUnique({ where: { name: usuario.trim() } }),
    prisma.book.findUnique({ where: { id: bookId }, select: { seriesId: true } }),
  ]);
  if (!user) return { ok: false as const, mensaje: 'Usuaria no encontrada' };
  if (!book?.seriesId) return { ok: true as const, volumenes: [] };

  const [siblings, overridesRaw] = await Promise.all([
    prisma.book.findMany({
      where: { seriesId: book.seriesId, deletedAt: null, id: { not: bookId } },
      select: { id: true, title: true, seriesOrder: true, coverUrl: true },
    }),
    prisma.seriesBookOverride.findMany({
      where: { userId: user.id, seriesId: book.seriesId },
      select: { posicion: true, tipo: true },
    }),
  ]);
  if (siblings.length === 0) return { ok: true as const, volumenes: [] };

  const overrideByPosition = new Map(overridesRaw.map((o) => [o.posicion, o.tipo]));

  const libraryRows = await prisma.library.findMany({
    where: { userId: user.id, bookId: { in: siblings.map((sibling) => sibling.id) } },
    select: { bookId: true, status: true },
  });
  const statusByBookId = new Map(libraryRows.map((row) => [row.bookId, row.status]));

  const volumenes = siblings
    .map((sibling) => {
      const libraryStatus = statusByBookId.get(sibling.id);
      const posicion = datosNumeroSaga(sibling.seriesOrder).posicion;
      const override = posicion != null ? overrideByPosition.get(posicion) : undefined;
      // Un tomo marcado como omitido o leído fuera de la app en la pestaña
      // Sagas no tiene entrada en Library: sin comprobar el override, el
      // panel lo mostraría con "Añadir" aunque la usuaria ya lo descartó.
      const estado = libraryStatus
        ? statusToFlutter(libraryStatus)
        : (override ?? 'NO_ANADIDO');
      return {
        bookId: sibling.id,
        titulo: sibling.title,
        numero: sibling.seriesOrder ?? '',
        coverUrl: sibling.coverUrl ?? '',
        estado,
      };
    })
    .sort((a, b) => {
      const byOrder = numeroSaga(a.numero) - numeroSaga(b.numero);
      return byOrder !== 0 ? byOrder : a.titulo.localeCompare(b.titulo, 'es');
    });

  return { ok: true as const, volumenes };
}
