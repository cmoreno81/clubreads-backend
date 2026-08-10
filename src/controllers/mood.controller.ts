import type { Request, Response } from 'express';
import { getMoodClub } from '../services/mood.service.js';

import { registrarMoodClub } from '../services/mood.service.js';
import { requestUserName } from '../middleware/auth.middleware.js';

export async function handleMoodClub(req: Request, res: Response) {
  const data = await getMoodClub(
    requestUserName(req),
  );
  return res.json(data);
}

export async function handleRegistrarMoodClub(req: Request, res: Response) {
  const data = await registrarMoodClub(
    requestUserName(req),
    String(req.body?.mood || ''),
  );
  return res.json(data);
}
