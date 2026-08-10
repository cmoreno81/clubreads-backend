import type { Request, Response } from 'express';
import {
  getClubvision,
  enviarVotacion,
  getMiVoto,
  getComoVotaron,
  getHistorialClubvision,
  getHistorialClubvisionPage,
} from '../services/clubvision.service.js';
import { requestUserName } from '../middleware/auth.middleware.js';
import {
  hasExplicitPagination,
  parsePagination,
} from '../utils/cursor-pagination.js';

export async function handleClubvision(req: Request, res: Response) {
  const data = await getClubvision(
    requestUserName(req),
  );
  return res.json(data);
}

export async function handleEnviarVotacion(req: Request, res: Response) {
  const votos = [
    String(req.body?.v1 || ''),
    String(req.body?.v2 || ''),
    String(req.body?.v3 || ''),
    String(req.body?.v4 || ''),
    String(req.body?.v5 || ''),
  ].filter(Boolean);

  const data = await enviarVotacion(
    requestUserName(req),
    votos,
  );
  return res.json(data);
}

export async function handleMiVoto(req: Request, res: Response) {
  const data = await getMiVoto(
    requestUserName(req),
  );
  return res.json(data);
}

export async function handleComoVotaron(req: Request, res: Response) {
  const data = await getComoVotaron(
    requestUserName(req),
  );
  return res.json(data);
}

export async function handleHistorialClubvision(req: Request, res: Response) {
  if (hasExplicitPagination(req.query)) {
    return res.json(
      await getHistorialClubvisionPage(
        requestUserName(req),
        parsePagination(req.query),
      ),
    );
  }
  const data = await getHistorialClubvision(
    requestUserName(req),
  );
  return res.json(data);
}
