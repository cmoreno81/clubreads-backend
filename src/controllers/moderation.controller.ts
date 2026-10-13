import type { Request, Response } from 'express';

import {
  bloquearUsuario,
  desbloquearUsuario,
  listarBloqueadas,
  reportarContenido,
} from '../services/moderation.service.js';

function value(req: Request, name: string) {
  return String(req.body?.[name] ?? '');
}

export async function handleBloquearUsuario(req: Request, res: Response) {
  return res.json(await bloquearUsuario(req.auth!.userId, value(req, 'nombre')));
}

export async function handleDesbloquearUsuario(req: Request, res: Response) {
  return res.json(await desbloquearUsuario(req.auth!.userId, value(req, 'nombre')));
}

export async function handleListarBloqueadas(req: Request, res: Response) {
  return res.json(await listarBloqueadas(req.auth!.userId));
}

export async function handleReportarContenido(req: Request, res: Response) {
  const tipo = value(req, 'tipo');
  const targetType =
    tipo === 'resena' ? 'resena' : tipo === 'comentarioProgreso' ? 'comentarioProgreso' : 'comentario';
  return res.json(
    await reportarContenido(req.auth!.userId, targetType, value(req, 'id'), value(req, 'motivo')),
  );
}
