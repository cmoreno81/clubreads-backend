import type { Request, Response } from 'express';
import { getTendenciasClub } from '../services/tendencias.service.js';
import { requestUserName } from '../middleware/auth.middleware.js';

export async function handleTendenciasClub(req: Request, res: Response) {
  const data = await getTendenciasClub(
    requestUserName(req),
  );
  return res.json(data);
}
