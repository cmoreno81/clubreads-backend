import type { Request, Response } from 'express';

import { getBingoLector, marcarCasillaBingo } from '../services/bingo.service.js';

export async function handleGetBingoLector(req: Request, res: Response) {
  const userId = req.auth!.userId;
  const yearParam = req.query.anio ?? req.query.year;
  const year = Number.isInteger(Number(yearParam))
    ? Number(yearParam)
    : new Date().getFullYear();
  return res.json(await getBingoLector(userId, year));
}

export async function handleMarcarCasillaBingo(req: Request, res: Response) {
  const userId = req.auth!.userId;
  const { anio, squareKey, marcar, nota } = req.body ?? {};
  const year = Number.isInteger(Number(anio)) ? Number(anio) : new Date().getFullYear();
  if (typeof squareKey !== 'string' || !squareKey.trim()) {
    return res.json({ ok: false, mensaje: 'Falta la casilla' });
  }
  return res.json(
    await marcarCasillaBingo(userId, year, squareKey, marcar !== false, nota),
  );
}
