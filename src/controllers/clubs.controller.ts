import type { Request, Response } from 'express';

import {
  createClub,
  getInvite,
  joinClub,
  listMyClubs,
  selectClub,
} from '../services/clubs.service.js';

export async function handleMyClubs(req: Request, res: Response) {
  return res.json(await listMyClubs(req.auth!.userId));
}

export async function handleCreateClub(req: Request, res: Response) {
  return res.json(
    await createClub(
      req.auth!.userId,
      String(req.body?.nombre ?? ''),
      String(req.body?.descripcion ?? ''),
    ),
  );
}

export async function handleJoinClub(req: Request, res: Response) {
  return res.json(
    await joinClub(
      req.auth!.userId,
      String(req.body?.codigo ?? ''),
    ),
  );
}

export async function handleSelectClub(req: Request, res: Response) {
  return res.json(
    await selectClub(
      req.auth!.userId,
      String(req.body?.clubId ?? ''),
    ),
  );
}

export async function handleClubInvite(req: Request, res: Response) {
  return res.json(
    await getInvite(
      req.auth!.userId,
      String(req.body?.clubId ?? req.query.clubId ?? ''),
    ),
  );
}
