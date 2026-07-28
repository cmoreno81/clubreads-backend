import type { Request, Response } from 'express';
import {
  getClubvision,
  enviarVotacion,
  getMiVoto,
  getComoVotaron,
  getHistorialClubvision,
} from '../services/clubvision.service.js';
import { requestUserName } from '../middleware/auth.middleware.js';

export async function handleClubvision(req: Request, res: Response) {
  const data = await getClubvision(
    requestUserName(req, req.query.usuario),
  );
  return res.json(data);
}

export async function handleEnviarVotacion(req: Request, res: Response) {
  const votos = [
    String(req.query.v1 || ''),
    String(req.query.v2 || ''),
    String(req.query.v3 || ''),
    String(req.query.v4 || ''),
    String(req.query.v5 || ''),
  ].filter(Boolean);

  const data = await enviarVotacion(
    requestUserName(
      req,
      req.body?.usuario ?? req.query.usuario,
    ),
    votos,
  );
  return res.json(data);
}

export async function handleMiVoto(req: Request, res: Response) {
  const data = await getMiVoto(
    requestUserName(req, req.query.usuario),
  );
  return res.json(data);
}

export async function handleComoVotaron(req: Request, res: Response) {
  const data = await getComoVotaron(
    requestUserName(req, req.query.usuario),
  );
  return res.json(data);
}

export async function handleHistorialClubvision(req: Request, res: Response) {
  const data = await getHistorialClubvision(
    requestUserName(req, req.query.usuario),
  );
  return res.json(data);
}
