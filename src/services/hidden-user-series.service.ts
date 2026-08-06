import { prisma } from '../prisma.js';

export class HiddenUserSeriesError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function requiredSeriesId(value: unknown) {
  const seriesId = String(value ?? '').trim();
  if (!seriesId) {
    throw new HiddenUserSeriesError(400, 'SERIES_ID_REQUIRED', 'sagaId es obligatorio.');
  }
  return seriesId;
}

export function excludeHiddenSeries<T extends { id: string }>(
  series: T[],
  hiddenSeriesIds: ReadonlySet<string>,
) {
  return series.filter(({ id }) => !hiddenSeriesIds.has(id));
}

export async function getHiddenUserSeries(userId: string) {
  const preferences = await prisma.hiddenUserSeries.findMany({
    where: {
      userId,
      tipo: 'OCULTA',
      series: {
        books: { some: { deletedAt: null } },
      },
    },
    select: {
      series: { select: { id: true, name: true } },
    },
    orderBy: {
      series: { name: 'asc' },
    },
  });
  return {
    ok: true,
    sagas: preferences.map(({ series }) => ({
      id: series.id,
      nombre: series.name,
    })),
  };
}

async function requireSeriesInUserHistory(userId: string, seriesId: string) {
  const series = await prisma.series.findUnique({
    where: { id: seriesId },
    select: {
      id: true,
      books: {
        where: {
          deletedAt: null,
          OR: [
            { library: { some: { userId } } },
            { readingCompletions: { some: { userId } } },
          ],
        },
        select: { id: true },
        take: 1,
      },
    },
  });
  if (!series) {
    throw new HiddenUserSeriesError(404, 'SERIES_NOT_FOUND', 'La saga no existe.');
  }
  if (series.books.length === 0) {
    throw new HiddenUserSeriesError(
      403,
      'SERIES_NOT_IN_USER_HISTORY',
      'La saga no está relacionada con tu biblioteca o historial.',
    );
  }
  return series;
}

export async function hideUserSeries(userId: string, rawSeriesId: unknown) {
  const seriesId = requiredSeriesId(rawSeriesId);
  await requireSeriesInUserHistory(userId, seriesId);
  await prisma.hiddenUserSeries.upsert({
    where: { userId_seriesId: { userId, seriesId } },
    update: { tipo: 'OCULTA' },
    create: { userId, seriesId, tipo: 'OCULTA' },
  });
  return { ok: true, sagaId: seriesId };
}

export async function removeUserSeries(userId: string, rawSeriesId: unknown) {
  const seriesId = requiredSeriesId(rawSeriesId);
  await requireSeriesInUserHistory(userId, seriesId);
  await prisma.hiddenUserSeries.upsert({
    where: { userId_seriesId: { userId, seriesId } },
    update: { tipo: 'ELIMINADA' },
    create: { userId, seriesId, tipo: 'ELIMINADA' },
  });
  return { ok: true, sagaId: seriesId };
}

export async function showUserSeries(userId: string, rawSeriesId: unknown) {
  const seriesId = requiredSeriesId(rawSeriesId);
  const series = await prisma.series.findUnique({
    where: { id: seriesId },
    select: { id: true },
  });
  if (!series) {
    throw new HiddenUserSeriesError(404, 'SERIES_NOT_FOUND', 'La saga no existe.');
  }
  await prisma.hiddenUserSeries.deleteMany({ where: { userId, seriesId } });
  return { ok: true, sagaId: seriesId };
}