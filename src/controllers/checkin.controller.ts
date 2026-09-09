import type { Request, Response } from 'express';
import {
  doCheckIn,
  getCheckinHistory,
  getHeatmap,
  getWrapped,
  undoCheckIn,
} from '../services/checkin.service.js';

// ─────────────────────────────────────────────────────────────────────────────

const RANGOS_PAGINAS = ['HASTA_50', 'DE_50_A_75', 'DE_75_A_100', 'MAS_DE_100'] as const;

export async function handleDoCheckin(req: Request, res: Response) {
  const userId = req.auth!.userId;
  const note: string | undefined = req.body?.nota ?? req.query.nota as string | undefined;
  const fecha: string | undefined = req.body?.fecha;
  const rangoRaw = req.body?.rango;
  const rango = RANGOS_PAGINAS.includes(rangoRaw) ? rangoRaw : undefined;

  const result = await doCheckIn(userId, note, fecha, rango);
  return res.json(result);
}

export async function handleUndoCheckin(req: Request, res: Response) {
  const userId = req.auth!.userId;
  const fecha: string = req.body?.fecha ?? '';

  const result = await undoCheckIn(userId, fecha);
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
