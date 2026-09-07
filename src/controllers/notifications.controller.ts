import type { Request, Response } from 'express';
import { NotificationType } from '@prisma/client';
import {
  getNotificaciones,
  getNotificacionesPage,
  eliminarNotificacion,
  marcarLeida,
  marcarTodasLeidas,
  eliminarTodasNotificaciones,
  getPreferenciasNotificacion,
  actualizarPreferenciaNotificacion,
  TIPOS_NOTIFICACION,
} from '../services/notifications.service.js';
import {
  hasExplicitPagination,
  parsePagination,
} from '../utils/cursor-pagination.js';

export async function handleGetNotificaciones(req: Request, res: Response) {
  if (hasExplicitPagination(req.query)) {
    return res.json(
      await getNotificacionesPage(req.auth!.userId, parsePagination(req.query)),
    );
  }
  return res.json(await getNotificaciones(req.auth!.userId));
}

export async function handleEliminarNotificacion(req: Request, res: Response) {
  const id = String(req.body?.id ?? '').trim();
  if (!id) return res.status(400).json({ ok: false, mensaje: 'id requerido' });
  return res.json(await eliminarNotificacion(req.auth!.userId, id));
}

export async function handleMarcarLeida(req: Request, res: Response) {
  const id = String(req.body?.id ?? '');
  if (!id) return res.status(400).json({ ok: false, mensaje: 'id requerido' });
  return res.json(await marcarLeida(req.auth!.userId, id));
}

export async function handleMarcarTodasLeidas(req: Request, res: Response) {
  return res.json(await marcarTodasLeidas(req.auth!.userId));
}

export async function handleEliminarTodasNotificaciones(req: Request, res: Response) {
  return res.json(await eliminarTodasNotificaciones(req.auth!.userId));
}

export async function handleGetPreferenciasNotificacion(req: Request, res: Response) {
  return res.json(await getPreferenciasNotificacion(req.auth!.userId));
}

export async function handleActualizarPreferenciaNotificacion(
  req: Request,
  res: Response,
) {
  const tipo = String(req.body?.tipo ?? '') as NotificationType;
  const activado = Boolean(req.body?.activado);
  if (!TIPOS_NOTIFICACION.includes(tipo)) {
    return res.status(400).json({ ok: false, mensaje: 'Tipo de notificación no válido' });
  }
  return res.json(
    await actualizarPreferenciaNotificacion(req.auth!.userId, tipo, activado),
  );
}