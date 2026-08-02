import { SeriesBookOverrideType } from '@prisma/client';
import { prisma } from '../prisma.js';

export async function setSeriesBookOverride({
  userId,
  seriesId,
  posicion,
  tipo,
}: {
  userId: string;
  seriesId: string;
  posicion: number;
  tipo: SeriesBookOverrideType;
}) {
  // Upsert — si ya existía lo reemplaza
  await prisma.seriesBookOverride.upsert({
    where: { userId_seriesId_posicion: { userId, seriesId, posicion } },
    create: { userId, seriesId, posicion, tipo },
    update: { tipo },
  });
  return { ok: true };
}

export async function removeSeriesBookOverride({
  userId,
  seriesId,
  posicion,
}: {
  userId: string;
  seriesId: string;
  posicion: number;
}) {
  await prisma.seriesBookOverride.deleteMany({
    where: { userId, seriesId, posicion },
  });
  return { ok: true };
}

export async function getSeriesOverrides(userId: string, seriesId: string) {
  const overrides = await prisma.seriesBookOverride.findMany({
    where: { userId, seriesId },
  });
  return overrides.map((o) => ({
    posicion: o.posicion,
    tipo: o.tipo,
  }));
}
