import type { Request, Response } from 'express';
import { requestUserName } from '../middleware/auth.middleware.js';
import {
  getPropuestaPendiente,
  crearPropuesta,
  apoyarPropuesta,
  cancelarPropuesta,
} from '../services/club-reading-proposal.service.js';

export async function handleGetPropuesta(req: Request, res: Response) {
  const data = await getPropuestaPendiente(requestUserName(req));
  return res.json(data ?? { propuesta: null });
}

export async function handleCrearPropuesta(req: Request, res: Response) {
  const bookTitle = String(req.body?.bookTitle || '');
  if (!bookTitle.trim()) {
    return res.status(400).json({ ok: false, error: 'Falta el título del libro' });
  }
  const data = await crearPropuesta(requestUserName(req), bookTitle);
  return res.json(data);
}

export async function handleApoyarPropuesta(req: Request, res: Response) {
  const propuestaId = String(req.body?.propuestaId || '');
  if (!propuestaId) {
    return res.status(400).json({ ok: false, error: 'Falta propuestaId' });
  }
  const data = await apoyarPropuesta(requestUserName(req), propuestaId);
  return res.json(data);
}

export async function handleCancelarPropuesta(req: Request, res: Response) {
  const propuestaId = String(req.body?.propuestaId || '');
  const data = await cancelarPropuesta(requestUserName(req), propuestaId);
  return res.json(data);
}
