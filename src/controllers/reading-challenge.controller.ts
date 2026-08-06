import type { Request, Response } from 'express';
import { prisma } from '../prisma.js';
import {
  getClubReadingChallenges,
  setReadingChallenge,
} from '../services/reading-challenge.service.js';

export async function handleGetClubChallenges(req: Request, res: Response) {
  return res.json(
    await getClubReadingChallenges(req.auth!.userName),
  );
}

export async function handleSetChallenge(req: Request, res: Response) {
  const user = await prisma.user.findUnique({
    where: { name: req.auth!.userName },
    select: { id: true },
  });
  if (!user) return res.status(401).json({ ok: false });
  const target = Number(req.body?.target);
  if (!Number.isFinite(target)) {
    return res.status(400).json({ ok: false, mensaje: 'Target inválido.' });
  }
  return res.json(await setReadingChallenge(user.id, Math.round(target)));
}