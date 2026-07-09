import type { Request, Response } from 'express';
import { getDashboard } from '../services/dashboard.service.js';

export async function handleDashboard(_req: Request, res: Response) {
  const data = await getDashboard();
  return res.json(data);
}