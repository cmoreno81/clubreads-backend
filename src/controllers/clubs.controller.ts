import type { Request, Response } from 'express';

import {
  createClub,
  crearEspacioPersonal,
  getInvite,
  joinClub,
  listMyClubs,
  selectClub,
  leaveClub,
  updateClub,
  getClubMembers,
  getPersonalidadesClub,
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
      String(req.body?.clubId ?? ''),
    ),
  );
}

export async function handleLeaveClub(req: Request, res: Response) {
  return res.json(
    await leaveClub(req.auth!.userId, String(req.body?.clubId ?? '')),
  );
}

export async function handleUpdateClub(req: Request, res: Response) {
  return handleUpdateClubWith(req, res, updateClub);
}

export async function handleUpdateClubWith(
  req: Request,
  res: Response,
  update: typeof updateClub,
) {
  return res.json(
    await update(req.auth!.userId, String(req.body?.clubId ?? ''), {
      nombre: req.body?.nombre,
      descripcion: req.body?.descripcion,
      avatarUrl: req.body?.avatarUrl,
    }),
  );
}

export async function handleGetClubMembers(req: Request, res: Response) {
  const clubId = String(req.query.clubId ?? '');
  return res.json(await getClubMembers(req.auth!.userId, clubId));
}

export async function handleCrearEspacioPersonal(req: Request, res: Response) {
  return res.json(await crearEspacioPersonal(req.auth!.userId));
}

export async function handleGetPersonalidadesClub(req: Request, res: Response) {
  return res.json(await getPersonalidadesClub(req.auth!.userId));
}
