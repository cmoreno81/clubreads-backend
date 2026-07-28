import type { Request, Response } from 'express';
import { getDashboard } from '../services/dashboard.service.js';
import { requestUserName } from '../middleware/auth.middleware.js';

export async function handleDashboard(req: Request, res: Response) {
  const data = await getDashboard(
    requestUserName(req, req.query.usuario),
  );
  return res.json(data);
}
