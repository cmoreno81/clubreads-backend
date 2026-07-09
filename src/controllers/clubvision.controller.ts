import type { Request, Response } from 'express';
import {
  getClubvision,
  enviarVotacion,
  getMiVoto,
  getComoVotaron,
  getHistorialClubvision,
} from '../services/clubvision.service.js';

export async function handleClubvision(req: Request, res: Response) {
  const data = await getClubvision(String(req.query.usuario || ''));
  return res.json(data);
}

export async function handleEnviarVotacion(req: Request, res: Response) {
  const votos = [
    String(req.query.v1 || ''),
    String(req.query.v2 || ''),
    String(req.query.v3 || ''),
    String(req.query.v4 || ''),
    String(req.query.v5 || ''),
  ].filter(Boolean);

  const data = await enviarVotacion(String(req.query.usuario || ''), votos);
  return res.json(data);
}

export async function handleMiVoto(req: Request, res: Response) {
  const data = await getMiVoto(String(req.query.usuario || ''));
  return res.json(data);
}

export async function handleComoVotaron(_req: Request, res: Response) {
  const data = await getComoVotaron();
  return res.json(data);
}

export async function handleHistorialClubvision(_req: Request, res: Response) {
  const data = await getHistorialClubvision();
  return res.json(data);
}
