import type { Request, Response } from 'express';

import {
  getAchievementsForUser,
  getRecentClubAchievements,
} from '../services/achievements.service.js';
import { requestUserName } from '../middleware/auth.middleware.js';

export async function handleGetAchievements(req: Request, res: Response) {
  const user = String(req.query.user ?? req.query.usuario ?? req.auth?.userName ?? '').trim();
  const data = await getAchievementsForUser(user || requestUserName(req));

  return res.json(data);
}

export async function handleGetRecentClubAchievements(req: Request, res: Response) {
  const data = await getRecentClubAchievements(requestUserName(req));

  return res.json(data);
}
