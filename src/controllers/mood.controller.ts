import type { Request, Response } from 'express';
import { getMoodClub } from '../services/mood.service.js';

export async function handleMoodClub(_req: Request, res: Response) {
  const data = await getMoodClub();
  return res.json(data);
}