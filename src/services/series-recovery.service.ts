import { ReadingStatus } from '@prisma/client';

import { prisma } from '../prisma.js';
import { actualizarEstado } from './books.service.js';

export class SeriesRecoveryError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Recupera una saga marcada como "Abandonada": esa etiqueta la pone
 * automáticamente el perfil cuando algún tomo de la saga está en estado
 * ABANDONED ("No era para mí" en la ficha del libro), no es una acción que
 * se pueda deshacer por sí sola. Recuperar la saga vuelve a poner en la
 * biblioteca (PENDIENTE) cada uno de esos tomos, reutilizando
 * `actualizarEstado` para heredar su misma limpieza de reseña/caché.
 * Los tomos con cualquier otro estado (leídos, en curso, pausados...) no
 * se tocan.
 */
export async function recoverAbandonedSeries(userId: string, rawSeriesId: unknown) {
  const seriesId = String(rawSeriesId ?? '').trim();
  if (!seriesId) {
    throw new SeriesRecoveryError(400, 'SERIES_ID_REQUIRED', 'sagaId es obligatorio.');
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { name: true },
  });
  if (!user) {
    throw new SeriesRecoveryError(404, 'USER_NOT_FOUND', 'Usuaria no encontrada.');
  }

  const series = await prisma.series.findUnique({
    where: { id: seriesId },
    select: { id: true },
  });
  if (!series) {
    throw new SeriesRecoveryError(404, 'SERIES_NOT_FOUND', 'La saga no existe.');
  }

  const abandonedBooks = await prisma.library.findMany({
    where: {
      userId,
      status: ReadingStatus.ABANDONED,
      book: { seriesId, deletedAt: null },
    },
    select: { book: { select: { title: true } } },
  });

  for (const { book } of abandonedBooks) {
    const resultado = await actualizarEstado(user.name, book.title, 'PENDIENTE');
    if (!resultado.ok) {
      throw new SeriesRecoveryError(
        500,
        'RECOVERY_FAILED',
        resultado.mensaje ?? `No se pudo recuperar "${book.title}".`,
      );
    }
  }

  return { ok: true, sagaId: seriesId, librosRecuperados: abandonedBooks.length };
}
