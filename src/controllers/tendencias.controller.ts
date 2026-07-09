import type { Request, Response } from 'express';
import { getTendenciasClub } from '../services/tendencias.service.js';

export async function handleTendenciasClub(_req: Request, res: Response) {
  const data = await getTendenciasClub();
  return res.json(data);
}