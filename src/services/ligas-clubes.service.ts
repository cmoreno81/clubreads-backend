/**
 * Ligas entre clubes — ranking de clubes (no de personas), calculado a
 * partir de los mismos RankingPointEvent que las Ligas individuales.
 *
 * Dos vistas del mismo dato, porque sumar puntos sin más premia siempre al
 * club con más gente:
 *  - "más activos": suma total de puntos de sus miembros participantes
 *    (presume de volumen, no es un ranking justo por tamaño).
 *  - "más eficientes": media de puntos por miembro participante (el
 *    ranking competitivo real — un club pequeño y constante puede ganar a
 *    uno grande y disperso).
 *
 * Solo compiten los clubes de tipo SOCIAL (los PERSONAL no son "equipos"),
 * y solo cuentan como "miembro participante" quienes están apuntadas a
 * Ligas (RankingParticipation). El ranking de eficiencia exige un mínimo de
 * miembros participantes para evitar que un club de una sola persona lo
 * gane por defecto — igual que `calcularCuotaAscensoDescenso` exige >=3
 * personas para mover división.
 */

import { prisma } from '../prisma.js';
import { currentSeasonNumber } from './ligas.service.js';

export const MIN_MIEMBROS_RANKING_EFICIENCIA = 3;

export type FilaClub = {
  clubId: string;
  nombre: string;
  avatarUrl: string | null;
  totalPoints: number;
  activeMembers: number;
  avgPoints: number;
  puesto: number;
};

export type ClubAgregado = {
  clubId: string;
  nombre: string;
  avatarUrl: string | null;
  totalPoints: number;
  activeMembers: number;
};

/**
 * Agrega los puntos de la temporada por club (suma de todos sus miembros
 * apuntadas a Ligas, y el nº de miembros apuntadas). Un mismo miembro suma
 * a TODOS los clubes SOCIAL a los que pertenece.
 */
async function agregarPorClub(season: number): Promise<ClubAgregado[]> {
  const [participantes, sumas, clubesConMiembros] = await Promise.all([
    prisma.rankingParticipation.findMany({ select: { userId: true } }),
    prisma.rankingPointEvent.groupBy({
      by: ['userId'],
      where: { seasonNumber: season },
      _sum: { points: true },
    }),
    prisma.club.findMany({
      where: { tipo: 'SOCIAL' },
      select: {
        id: true,
        name: true,
        avatarUrl: true,
        members: { select: { userId: true } },
      },
    }),
  ]);

  const participantesSet = new Set(participantes.map((p) => p.userId));
  const puntosPorUser = new Map(
    sumas.map((s) => [s.userId, s._sum.points ?? 0]),
  );

  const agregados: ClubAgregado[] = [];
  for (const club of clubesConMiembros) {
    let totalPoints = 0;
    let activeMembers = 0;
    for (const { userId } of club.members) {
      if (!participantesSet.has(userId)) continue;
      activeMembers += 1;
      totalPoints += puntosPorUser.get(userId) ?? 0;
    }
    if (activeMembers === 0) continue;
    agregados.push({
      clubId: club.id,
      nombre: club.name,
      avatarUrl: club.avatarUrl,
      totalPoints,
      activeMembers,
    });
  }
  return agregados;
}

export function ordenarPorTotal(agregados: ClubAgregado[]): FilaClub[] {
  return [...agregados]
    .sort(
      (a, b) =>
        b.totalPoints - a.totalPoints || a.nombre.localeCompare(b.nombre),
    )
    .map((c, i) => ({
      ...c,
      avgPoints: c.activeMembers > 0 ? c.totalPoints / c.activeMembers : 0,
      puesto: i + 1,
    }));
}

export function ordenarPorMedia(agregados: ClubAgregado[]): FilaClub[] {
  return [...agregados]
    .filter((c) => c.activeMembers >= MIN_MIEMBROS_RANKING_EFICIENCIA)
    .sort((a, b) => {
      const avgA = a.totalPoints / a.activeMembers;
      const avgB = b.totalPoints / b.activeMembers;
      return avgB - avgA || a.nombre.localeCompare(b.nombre);
    })
    .map((c, i) => ({
      ...c,
      avgPoints: c.totalPoints / c.activeMembers,
      puesto: i + 1,
    }));
}

/** Live: las dos tablas de la temporada indicada (por defecto, la actual). */
export async function tablaLigaClubes(
  season?: number,
): Promise<{ season: number; masActivos: FilaClub[]; masEficientes: FilaClub[] }> {
  const s = season ?? currentSeasonNumber();
  const agregados = await agregarPorClub(s);
  return {
    season: s,
    masActivos: ordenarPorTotal(agregados),
    masEficientes: ordenarPorMedia(agregados),
  };
}

/**
 * Congela el resultado de una temporada ya cerrada en
 * ClubRankingSeasonResult (histórico permanente). Idempotente: se puede
 * volver a llamar sin duplicar filas (upsert por clubId+seasonNumber).
 */
export async function cerrarTemporadaClubes(season: number): Promise<number> {
  const agregados = await agregarPorClub(season);
  const porTotal = ordenarPorTotal(agregados);
  const porMedia = ordenarPorMedia(agregados);
  const rankTotalPorClub = new Map(porTotal.map((f) => [f.clubId, f.puesto]));
  const rankAvgPorClub = new Map(porMedia.map((f) => [f.clubId, f.puesto]));

  // Un club que no llega al mínimo de miembros para el ranking de eficiencia
  // no tiene puesto ahí; se guarda como "fuera de tabla" (último puesto + 1
  // del propio total, para no mentir con un rankAvg=0 inexistente).
  const fueraDeTabla = porMedia.length + 1;

  let n = 0;
  for (const fila of porTotal) {
    await prisma.clubRankingSeasonResult.upsert({
      where: {
        clubId_seasonNumber: { clubId: fila.clubId, seasonNumber: season },
      },
      create: {
        clubId: fila.clubId,
        seasonNumber: season,
        totalPoints: fila.totalPoints,
        activeMembers: fila.activeMembers,
        avgPoints: fila.avgPoints,
        rankTotal: rankTotalPorClub.get(fila.clubId) ?? fila.puesto,
        rankAvg: rankAvgPorClub.get(fila.clubId) ?? fueraDeTabla,
      },
      update: {
        totalPoints: fila.totalPoints,
        activeMembers: fila.activeMembers,
        avgPoints: fila.avgPoints,
        rankTotal: rankTotalPorClub.get(fila.clubId) ?? fila.puesto,
        rankAvg: rankAvgPorClub.get(fila.clubId) ?? fueraDeTabla,
      },
    });
    n += 1;
  }
  return n;
}

/** Histórico: club ganador (rankAvg=1, el ranking justo) de una temporada cerrada. */
export async function clubGanadorTemporada(season: number) {
  return prisma.clubRankingSeasonResult.findFirst({
    where: { seasonNumber: season, rankAvg: 1 },
    include: { club: { select: { id: true, name: true, avatarUrl: true, slug: true } } },
  });
}
