import type { Request, Response } from 'express';
import type { ClubVisibility } from '@prisma/client';

import {
  cambiarVisibilidadClub,
  listarClubesPublicos,
  listarSolicitudesPendientes,
  responderSolicitud,
  solicitarUnirseClub,
} from '../services/club-directory.service.js';

export async function handleClubesPublicos(req: Request, res: Response) {
  const search = typeof req.query.q === 'string' ? req.query.q : undefined;
  return res.json({ ok: true, clubes: await listarClubesPublicos(search) });
}

export async function handleCambiarVisibilidadClub(req: Request, res: Response) {
  const userId = req.auth!.userId;
  const clubId = String(req.body?.clubId ?? '').trim();
  const visibility = String(req.body?.visibility ?? '').trim() as ClubVisibility;
  return res.json(
    await cambiarVisibilidadClub(userId, clubId, visibility),
  );
}

export async function handleSolicitarUnirseClub(req: Request, res: Response) {
  const userId = req.auth!.userId;
  const clubId = String(req.body?.clubId ?? '').trim();
  return res.json(await solicitarUnirseClub(userId, clubId));
}

export async function handleSolicitudesClub(req: Request, res: Response) {
  const userId = req.auth!.userId;
  const clubId = String(req.query.clubId ?? '').trim();
  return res.json({
    ok: true,
    solicitudes: await listarSolicitudesPendientes(userId, clubId),
  });
}

export async function handleResponderSolicitudClub(req: Request, res: Response) {
  const userId = req.auth!.userId;
  const clubId = String(req.body?.clubId ?? '').trim();
  const requestId = String(req.body?.requestId ?? '').trim();
  const aceptar = req.body?.aceptar === true;
  return res.json(
    await responderSolicitud(userId, clubId, requestId, aceptar),
  );
}
