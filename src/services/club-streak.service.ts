/**
 * Racha del club: días consecutivos en los que AL MENOS UNA persona del
 * club ha tenido actividad lectora (mismo criterio de "día activo" que la
 * racha individual y el mapa de calor — ver `getActiveDatesForUsers`).
 *
 * La actividad de lectura no está ligada a un club concreto (una persona
 * puede pertenecer a varios), así que esto responde a "¿este club, entre
 * quienes lo forman hoy, sigue vivo?" — no a "actividad hecha *dentro* de
 * este club" en un sentido estricto de comentarios/votos. Es justo lo que
 * Mistbook no puede tener: ellos no tienen clubes, solo personas.
 */

import { prisma } from '../prisma.js';
import { getActiveDatesForUsers, todayString } from './checkin.service.js';

const LOOKBACK_DAYS = 400;

export type ClubStreak = {
  clubId: string;
  racha: number;
  ultimoDiaActivo: string | null;
};

/**
 * Cálculo puro (sin BD): dado el conjunto de días activos de un club y la
 * fecha de hoy, devuelve la racha actual y el último día con actividad.
 * Separado de `getClubStreak` para poder testearlo sin base de datos —
 * misma lógica que `getStreak` en checkin.service.ts, a nivel de club.
 */
export function calcularRachaClub(
  dates: Set<string>,
  today: string,
): { racha: number; ultimoDiaActivo: string | null } {
  if (dates.size === 0) return { racha: 0, ultimoDiaActivo: null };

  const yesterday = new Date(`${today}T00:00:00.000Z`);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const yesterdayStr = yesterday.toISOString().slice(0, 10);

  const ultimoDiaActivo = [...dates].sort().at(-1) ?? null;

  const startFrom = dates.has(today)
    ? today
    : dates.has(yesterdayStr)
      ? yesterdayStr
      : null;
  if (!startFrom) return { racha: 0, ultimoDiaActivo };

  let racha = 0;
  const cursor = new Date(`${startFrom}T00:00:00.000Z`);
  while (true) {
    const dateStr = cursor.toISOString().slice(0, 10);
    if (!dates.has(dateStr)) break;
    racha += 1;
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }

  return { racha, ultimoDiaActivo };
}

export async function getClubStreak(clubId: string): Promise<ClubStreak> {
  const miembros = await prisma.clubMember.findMany({
    where: { clubId },
    select: { userId: true },
  });
  const userIds = miembros.map((m) => m.userId);
  if (userIds.length === 0) {
    return { clubId, racha: 0, ultimoDiaActivo: null };
  }

  const since = new Date();
  since.setDate(since.getDate() - LOOKBACK_DAYS);
  const sinceStr = since.toISOString().slice(0, 10);
  const today = todayString();

  const dates = await getActiveDatesForUsers(userIds, sinceStr, today);
  const { racha, ultimoDiaActivo } = calcularRachaClub(dates, today);
  return { clubId, racha, ultimoDiaActivo };
}

/** Racha de varios clubes a la vez (para no hacer N llamadas desde `misClubes`). */
export async function getClubStreaks(
  clubIds: string[],
): Promise<Map<string, ClubStreak>> {
  const resultados = await Promise.all(clubIds.map(getClubStreak));
  return new Map(resultados.map((r) => [r.clubId, r]));
}
