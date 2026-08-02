import type { Request, Response } from 'express';
import {
  setSeriesBookOverride,
  removeSeriesBookOverride,
  getSeriesOverrides,
} from '../services/series-override.service.js';
import { SeriesBookOverrideType } from '@prisma/client';

export async function handleSetSeriesOverride(req: Request, res: Response) {
  const { seriesId, posicion, tipo } = req.body ?? {};
  if (!seriesId || !posicion || !tipo) {
    return res.status(400).json({ ok: false, mensaje: 'seriesId, posicion y tipo son obligatorios' });
  }
  if (!Object.values(SeriesBookOverrideType).includes(tipo)) {
    return res.status(400).json({ ok: false, mensaje: 'tipo inválido' });
  }
  return res.json(await setSeriesBookOverride({
    userId: req.auth!.userId,
    seriesId,
    posicion: Number(posicion),
    tipo,
  }));
}

export async function handleRemoveSeriesOverride(req: Request, res: Response) {
  const { seriesId, posicion } = req.body ?? {};
  if (!seriesId || !posicion) {
    return res.status(400).json({ ok: false, mensaje: 'seriesId y posicion son obligatorios' });
  }
  return res.json(await removeSeriesBookOverride({
    userId: req.auth!.userId,
    seriesId,
    posicion: Number(posicion),
  }));
}

export async function handleGetSeriesOverrides(req: Request, res: Response) {
  const seriesId = String(req.query.seriesId ?? '');
  if (!seriesId) {
    return res.status(400).json({ ok: false, mensaje: 'seriesId obligatorio' });
  }
  return res.json(await getSeriesOverrides(req.auth!.userId, seriesId));
}
