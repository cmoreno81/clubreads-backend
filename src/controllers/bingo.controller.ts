import type { Request, Response } from 'express';

import { prisma } from '../prisma.js';
import { getBingoLector, marcarCasillaBingo } from '../services/bingo.service.js';
import { syncAchievementsForUser } from '../services/achievements.service.js';

export async function handleGetBingoLector(req: Request, res: Response) {
  const userId = req.auth!.userId;
  const yearParam = req.query.anio ?? req.query.year;
  const year = Number.isInteger(Number(yearParam))
    ? Number(yearParam)
    : new Date().getFullYear();
  return res.json(await getBingoLector(userId, year));
}

export async function handleMarcarCasillaBingo(req: Request, res: Response) {
  const userId = req.auth!.userId;
  const { anio, squareKey, marcar, nota } = req.body ?? {};
  const year = Number.isInteger(Number(anio)) ? Number(anio) : new Date().getFullYear();
  if (typeof squareKey !== 'string' || !squareKey.trim()) {
    return res.json({ ok: false, mensaje: 'Falta la casilla' });
  }
  const resultado = await marcarCasillaBingo(userId, year, squareKey, marcar !== false, nota);

  // Marcar/desmarcar una casilla puede cruzar (o dejar de cruzar) el
  // umbral de "línea de bingo" o "bingo completo" — resincronizamos esos
  // logros igual que se hace al terminar un libro.
  void (async () => {
    const userName = req.auth!.userName;
    const memberships = await prisma.clubMember.findMany({
      where: { userId },
      select: { clubId: true },
    });
    if (memberships.length === 0) {
      await syncAchievementsForUser(userId, userName, null).catch(() => {});
      return;
    }
    for (const { clubId } of memberships) {
      await syncAchievementsForUser(userId, userName, clubId).catch(() => {});
    }
  })();

  return res.json(resultado);
}
