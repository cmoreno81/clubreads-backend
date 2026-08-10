import type { Request, Response } from 'express';
import { getDashboard } from '../services/dashboard.service.js';
import { requestUserName } from '../middleware/auth.middleware.js';

export async function handleDashboard(req: Request, res: Response) {
  const data = await getDashboard(
    requestUserName(req),
  );
  return res.json(data);
}

import { getAfinidadDetalle } from '../services/dashboard.service.js';

export async function handleAfinidadDetalle(req: Request, res: Response) {
  const miembroId = String(req.query.miembroId ?? '');
  if (!miembroId) return res.status(400).json({ ok: false, mensaje: 'miembroId requerido' });
  const data = await getAfinidadDetalle(req.auth!.userId, miembroId);
  return res.json(data);
}
