import type { Request, Response } from 'express';
import { getRanking } from '../services/ranking.service.js';

export async function handleRanking(req: Request, res: Response) {
  const data = await getRanking(Number(req.query.anio || new Date().getFullYear()));
  return res.json(data);
}
