import type { Request, Response } from 'express';

import {
  actualizarAvatarPerfil,
  actualizarFechasLectura,
  getPerfilUsuario,
  getPerfilHistorialPage,
  toggleFavorito,
  reemplazarFavorito,
  getFavoritosUsuario,
  getFavoritosDelClub,
} from '../services/perfil.service.js';
import { requestUserName } from '../middleware/auth.middleware.js';
import {
  hasExplicitPagination,
  parsePagination,
} from '../utils/cursor-pagination.js';

export async function handlePerfilUsuario(
  req: Request,
  res: Response,
) {
  const perfil = String(
    req.query.perfil ?? req.query.usuario ?? req.auth?.userName ?? '',
  );
  if (hasExplicitPagination(req.query)) {
    return res.json(
      await getPerfilHistorialPage(
        perfil,
        requestUserName(req),
        parsePagination(req.query),
      ),
    );
  }
  const data = await getPerfilUsuario(
    perfil,
    requestUserName(req),
  );

  return res.json(data);
}

export async function handleActualizarFechasLectura(
  req: Request,
  res: Response,
) {
  const body = req.body ?? {};

  const valoracionRecibida = body.valoracion;
  const resenaRecibida = body.resena;

  const data = await actualizarFechasLectura({
    usuario: requestUserName(req),
    libraryId: String(body.libraryId ?? ''),
    completionId: String(body.completionId ?? ''),
    fechaInicio: body.fechaInicio ?? '',
    fechaFin: body.fechaFin ?? '',

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
    usuario: requestUserName(req),
    avatarUrl: String(body.avatarUrl ?? ''),
  });

  return res.json(data);
}

export async function handleToggleFavorito(req: Request, res: Response) {
  const body = req.body ?? {};
  try {
    const data = await toggleFavorito({
      usuario: requestUserName(req),
      bookId: String(body.bookId ?? ''),
    });
    return res.json(data);
  } catch (err) {
    const mensaje = err instanceof Error ? err.message : 'Error interno';
    return res.status(200).json({ ok: false, mensaje });
  }
}

export async function handleReemplazarFavorito(req: Request, res: Response) {
  const body = req.body ?? {};
  try {
    return res.json(await reemplazarFavorito({
      usuario: requestUserName(req),
      bookIdActual: String(body.bookIdActual ?? ''),
      bookIdNuevo: String(body.bookIdNuevo ?? ''),
    }));
  } catch (err) {
    const mensaje = err instanceof Error ? err.message : 'Error interno';
    return res.status(200).json({ ok: false, mensaje });
  }
}

export async function handleGetFavoritos(req: Request, res: Response) {
  const perfil = String(req.query.perfil ?? req.query.usuario ?? req.auth?.userName ?? '');
  const data = await getFavoritosUsuario({ usuario: perfil });
  return res.json(data);
}

export async function handleGetFavoritosDelClub(req: Request, res: Response) {
  const data = await getFavoritosDelClub({ usuario: requestUserName(req) });
  return res.json(data);
}
