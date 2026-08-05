import type { Request, Response } from 'express';
import { requestUserName } from '../middleware/auth.middleware.js';
import { prisma } from '../prisma.js';
import { saveUserSeriesOrder } from '../services/user-series-order.service.js';

export async function handleSaveUserSeriesOrder(req: Request, res: Response) {
  const userName = requestUserName(req);
  const user = await prisma.user.findUnique({ where: { name: userName } });
  if (!user) return res.status(401).json({ ok: false, mensaje: 'No autenticada' });

  const seriesId = String(req.body?.seriesId ?? '').trim();
  const rawOrder = req.body?.order;

  if (!seriesId || !Array.isArray(rawOrder)) {
    return res.status(400).json({ ok: false, mensaje: 'Datos incorrectos' });
  }

  const order = rawOrder
    .map((item: unknown) => {
      if (typeof item !== 'object' || item === null) return null;
      const o = item as Record<string, unknown>;
      const bookId = String(o.bookId ?? '').trim();
      const posicion = Number(o.posicion);
      if (!bookId || !Number.isInteger(posicion) || posicion < 1) return null;
      return { bookId, posicion };
    })
    .filter((item): item is { bookId: string; posicion: number } => item !== null);

  const result = await saveUserSeriesOrder(user.id, seriesId, order);
  return res.json(result);
}