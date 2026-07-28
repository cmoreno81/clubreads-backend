import type { Request, Response } from 'express';
import { getMoodClub } from '../services/mood.service.js';

import { registrarMoodClub } from '../services/mood.service.js';
import { requestUserName } from '../middleware/auth.middleware.js';

export async function handleMoodClub(req: Request, res: Response) {
  const data = await getMoodClub(
    requestUserName(req, req.query.usuario),
  );
  return res.json(data);
}

export async function handleRegistrarMoodClub(req: Request, res: Response) {
  const data = await registrarMoodClub(
    requestUserName(
      req,
      req.body?.usuario ?? req.query.usuario,
    ),
    String(req.query.mood || req.body?.mood || ''),
  );
  return res.json(data);
}
