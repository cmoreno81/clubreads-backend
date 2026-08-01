import type { Request, Response } from 'express';
import {
  getNotificaciones,
  marcarLeida,
  marcarTodasLeidas,
} from '../services/notifications.service.js';

export async function handleGetNotificaciones(req: Request, res: Response) {
  return res.json(await getNotificaciones(req.auth!.userId));
}

export async function handleMarcarLeida(req: Request, res: Response) {
  const id = String(req.body?.id ?? '');
  if (!id) return res.status(400).json({ ok: false, mensaje: 'id requerido' });
  return res.json(await marcarLeida(req.auth!.userId, id));
}

export async function handleMarcarTodasLeidas(req: Request, res: Response) {
  return res.json(await marcarTodasLeidas(req.auth!.userId));
}
