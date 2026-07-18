import type { Request, Response } from 'express';
import { getMoodClub } from '../services/mood.service.js';

import { registrarMoodClub } from '../services/mood.service.js';

export async function handleMoodClub(req: Request, res: Response) {
  const data = await getMoodClub(String(req.query.usuario || ''));
  return res.json(data);
}

export async function handleRegistrarMoodClub(req: Request, res: Response) {
  const data = await registrarMoodClub(
    String(req.query.usuario || req.body?.usuario || ''),
    String(req.query.mood || req.body?.mood || ''),
  );
  return res.json(data);
}
