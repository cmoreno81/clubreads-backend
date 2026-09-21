import type { Request, Response } from 'express';

import { prisma } from '../prisma.js';
import { ClubContextError } from '../services/club-context.service.js';
import { getClubWrapped } from '../services/club-wrapped.service.js';

export async function handleGetClubWrapped(req: Request, res: Response) {
  const userId = req.auth!.userId;
  const clubId = String(req.query.clubId ?? '').trim();
  const year = Number(req.query.year ?? new Date().getUTCFullYear());

  const membership = await prisma.clubMember.findUnique({
    where: { clubId_userId: { clubId, userId } },
  });
  if (!membership) {
    throw new ClubContextError('No perteneces a ese club', 403, 'NOT_CLUB_MEMBER');
  }

  return res.json(await getClubWrapped(clubId, year));
}
