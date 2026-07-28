import type { Request, Response } from 'express';

import { getGeneralDashboard } from '../services/general-dashboard.service.js';

export async function handleGeneralDashboard(
  req: Request,
  res: Response,
) {
  const data = await getGeneralDashboard(req.auth!.userId);
  if (!data) {
    return res.status(404).json({
      ok: false,
      error: 'USER_NOT_FOUND',
      mensaje: 'Cuenta no encontrada',
    });
  }
  return res.json(data);
}
