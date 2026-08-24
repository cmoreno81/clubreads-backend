import type { Request, Response } from 'express';
import { getUpcomingReleases } from '../services/upcoming-releases.service.js';

function parseDate(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export async function handleGetUpcomingReleases(req: Request, res: Response) {
  const from = parseDate(req.query.from);
  const to = parseDate(req.query.to);
  if (from === null || to === null || (from && to && from > to)) {
    return res.status(400).json({ ok: false, mensaje: 'Rango de fechas no válido.' });
  }
  const rawLimit = Number(req.query.limit ?? 40);
  if (!Number.isFinite(rawLimit) || rawLimit < 1) {
    return res.status(400).json({ ok: false, mensaje: 'Límite no válido.' });
  }
  try {
    const result = await getUpcomingReleases(req.auth!.userName, {
      from: from ?? undefined,
      to: to ?? undefined,
      genre: typeof req.query.genre === 'string' ? req.query.genre.trim() : undefined,
      limit: rawLimit,
    });
    if (!result.ok) return res.status(404).json(result);
    return res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error inesperado';
    return res.status(500).json({ ok: false, mensaje: message });
  }
}
