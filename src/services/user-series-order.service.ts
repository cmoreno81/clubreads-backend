import { prisma } from '../prisma.js';

/**
 * Guarda el orden personal de un usuario para una saga.
 * Recibe un array de { bookId, posicion } en el nuevo orden deseado.
 * Usa upsert para no perder datos si ya existía un orden previo.
 */
export async function saveUserSeriesOrder(
  userId: string,
  seriesId: string,
  order: Array<{ bookId: string; posicion: number }>,
) {
  // Borrar el orden anterior de esta saga para este usuario
  await prisma.userSeriesOrder.deleteMany({ where: { userId, seriesId } });

  if (order.length === 0) return { ok: true };

  await prisma.userSeriesOrder.createMany({
    data: order.map(({ bookId, posicion }) => ({
      userId,
      seriesId,
      bookId,
      posicion,
    })),
  });

  return { ok: true };
}

/**
 * Devuelve el orden personal de un usuario para todas sus sagas.
 * Mapa: seriesId -> Map<bookId, posicion>
 */
export async function getUserSeriesOrders(userId: string) {
  const rows = await prisma.userSeriesOrder.findMany({
    where: { userId },
  });

  const bySeriesId = new Map<string, Map<string, number>>();
  for (const row of rows) {
    if (!bySeriesId.has(row.seriesId)) {
      bySeriesId.set(row.seriesId, new Map());
    }
    bySeriesId.get(row.seriesId)!.set(row.bookId, row.posicion);
  }
  return bySeriesId;
}