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

  const valoracionRecibida =
    Object.prototype.hasOwnProperty.call(body, 'valoracion')
      ? body.valoracion
      : req.query.valoracion;

  const resenaRecibida =
    Object.prototype.hasOwnProperty.call(body, 'resena')
      ? body.resena
      : req.query.resena;

  const data = await actualizarFechasLectura({
    usuario: String(
      body.usuario ?? req.query.usuario ?? '',
    ),
    libraryId: String(
      body.libraryId ?? req.query.libraryId ?? '',
    ),
    completionId: String(
      body.completionId ?? req.query.completionId ?? '',
    ),
    fechaInicio:
      body.fechaInicio ?? req.query.fechaInicio ?? '',
    fechaFin:
      body.fechaFin ?? req.query.fechaFin ?? '',

    /*
     * `undefined` significa que la APK antigua no ha enviado
     * estos campos y, por tanto, debemos conservarlos.
     *
     * Una cadena vacía sí significa que la nueva APK quiere
     * eliminar la valoración o la reseña.
     */
    valoracion: valoracionRecibida,
    resena: resenaRecibida,
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
