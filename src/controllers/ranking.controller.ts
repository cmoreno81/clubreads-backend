import type { Request, Response } from 'express';
import { getRanking } from '../services/ranking.service.js';
import { requestUserName } from '../middleware/auth.middleware.js';

export async function handleRanking(req: Request, res: Response) {
  const data = await getRanking(
    Number(req.query.anio || new Date().getFullYear()),
    requestUserName(req, req.query.usuario),
  );
  return res.json(data);
}
