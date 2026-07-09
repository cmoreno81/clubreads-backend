import type { Request, Response } from 'express';
import { getRanking } from '../services/ranking.service.js';

export async function handleRanking(_req: Request, res: Response) {
  const data = await getRanking();
  return res.json(data);
}