import type { Request, Response } from 'express';

import {
  desgloseLiga,
  getLiga,
  getLigaHistorial,
  getLigaTemporadaCerrada,
  medallasUsuario,
  salirDeLaLiga,
  unirseALaLiga,
} from '../services/ligas.service.js';
import { tablaLigaClubes } from '../services/ligas-clubes.service.js';

export async function handleGetLiga(req: Request, res: Response) {
  const userId = req.auth!.userId;
  return res.json(await getLiga(userId));
}

export async function handleGetLigaDesglose(req: Request, res: Response) {
  const targetUserId = String(req.query.userId ?? '').trim();
  return res.json(await desgloseLiga(targetUserId));
}

export async function handleGetLigaMedallas(req: Request, res: Response) {
  const targetUserId = String(req.query.userId ?? '').trim();
  return res.json(await medallasUsuario(targetUserId));
}

export async function handleUnirseLiga(req: Request, res: Response) {
  const userId = req.auth!.userId;
  await unirseALaLiga(userId);
  return res.json(await getLiga(userId));
}

export async function handleSalirLiga(req: Request, res: Response) {
  const userId = req.auth!.userId;
  await salirDeLaLiga(userId);
  return res.json({ ok: true, participando: false });
}

export async function handleGetLigaHistorial(req: Request, res: Response) {
  const userId = req.auth!.userId;
  return res.json(await getLigaHistorial(userId));
}

export async function handleGetLigaTemporadaCerrada(req: Request, res: Response) {
  const userId = req.auth!.userId;
  const season = Number(req.query.temporada ?? req.query.season);
  if (!Number.isInteger(season)) {
    return res.json({ ok: false, mensaje: 'Falta el número de temporada' });
  }
  return res.json(await getLigaTemporadaCerrada(userId, season));
}

export async function handleGetLigaClubes(req: Request, res: Response) {
  const seasonParam = req.query.season;
  const season =
    typeof seasonParam === 'string' && seasonParam.trim() !== ''
      ? Number(seasonParam)
      : undefined;
  return res.json(await tablaLigaClubes(season));
}
