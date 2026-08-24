import type { Request, Response } from 'express';
import { getNewReleases } from '../services/new-releases.service.js';

export async function handleGetNewReleases(req: Request, res: Response) {
  const limit = Number(req.query.limit ?? 40);
  if (!Number.isFinite(limit) || limit < 1) {
    return res.status(400).json({ ok: false, mensaje: 'Límite no válido.' });
  }
  try {
    const result = await getNewReleases(req.auth!.userName, limit);
    if (!result.ok) return res.status(404).json(result);
    return res.json(result);
  } catch (error) {
    return res.status(500).json({
      ok: false,
      mensaje: error instanceof Error ? error.message : 'Error inesperado',
    });
  }
}
