import type { Request, Response } from 'express';

import {
  actualizarAvatarPerfil,
  actualizarFechasLectura,
  getPerfilUsuario,
} from '../services/perfil.service.js';

export async function handlePerfilUsuario(
  req: Request,
  res: Response,
) {
  const data = await getPerfilUsuario(
    String(req.query.usuario || ''),
  );

  return res.json(data);
}

export async function handleActualizarFechasLectura(
  req: Request,
  res: Response,
) {
  const body = req.body ?? {};

  const data = await actualizarFechasLectura({
    usuario: String(
      body.usuario ?? req.query.usuario ?? '',
    ),
    libraryId: String(
      body.libraryId ?? req.query.libraryId ?? '',
    ),
    fechaInicio:
      body.fechaInicio ?? req.query.fechaInicio ?? '',
    fechaFin:
      body.fechaFin ?? req.query.fechaFin ?? '',
  });

  return res.json(data);
}

export async function handleActualizarAvatarPerfil(
  req: Request,
  res: Response,
) {
  const body = req.body ?? {};

  const data = await actualizarAvatarPerfil({
    usuario: String(
      body.usuario ?? req.query.usuario ?? '',
    ),
    avatarUrl: String(
      body.avatarUrl ?? req.query.avatarUrl ?? '',
    ),
  });

  return res.json(data);
}