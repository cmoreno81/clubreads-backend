import type { Request, Response } from 'express';
import { doCheckIn, getCheckinHistory, getHeatmap, getWrapped } from '../services/checkin.service.js';

// ─────────────────────────────────────────────────────────────────────────────

export async function handleDoCheckin(req: Request, res: Response) {
  const userId = req.auth!.userId;
  const note: string | undefined = req.body?.nota ?? req.query.nota as string | undefined;

  const result = await doCheckIn(userId, note);
  return res.json(result);
}

export async function handleGetCheckinHistory(req: Request, res: Response) {
  const userId = req.auth!.userId;
  const days = Number(req.query.dias ?? 365);

  const result = await getCheckinHistory(userId, isNaN(days) ? 365 : days);
  return res.json(result);
}

export async function handleGetHeatmap(req: Request, res: Response) {
  const userId = req.auth!.userId;
  const year = Number(req.query.anio ?? new Date().getFullYear());

  const result = await getHeatmap(userId, isNaN(year) ? new Date().getFullYear() : year);
  return res.json(result);
}

export async function handleGetWrapped(req: Request, res: Response) {
  const userId = req.auth!.userId;
  const year = Number(req.query.anio ?? new Date().getFullYear());

  const result = await getWrapped(userId, isNaN(year) ? new Date().getFullYear() : year);
  return res.json(result);
}
