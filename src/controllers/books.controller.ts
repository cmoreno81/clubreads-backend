import type { Request, Response } from 'express';
import {
  getLibros,
  getLibrosFinalizados,
  anadirLibroExistente,
  actualizarPreferenciasLibro,
  iniciarLectura,
  actualizarEstado,
  actualizarValoracion,
  crearLibro,
  quitarLibroPendientes,
  editarLibro,
  actualizarProgresoLectura,
} from '../services/books.service.js';
import { requestUserName } from '../middleware/auth.middleware.js';

export async function handleLibros(req: Request, res: Response) {
  const data = await getLibros(
    requestUserName(req, req.query.usuario),
  );
  return res.json(data);
}

export async function handleActualizarProgresoLectura(
  req: Request,
  res: Response,
) {
  const body = req.body ?? {};
  const data = await actualizarProgresoLectura(
    requestUserName(
      req,
      body.usuario ?? req.query.usuario,
    ),
    String(body.libro ?? req.query.libro ?? ''),
    Number(body.progreso ?? req.query.progreso ?? 0),
    String(body.comentario ?? req.query.comentario ?? ''),
    body.paginaActual === undefined && req.query.paginaActual === undefined
      ? undefined
      : Number(body.paginaActual ?? req.query.paginaActual),
    body.paginasTotales === undefined && req.query.paginasTotales === undefined
      ? undefined
      : Number(body.paginasTotales ?? req.query.paginasTotales),
  );
  return res.json(data);
}

export async function handleLibrosFinalizados(req: Request, res: Response) {
  const data = await getLibrosFinalizados(
    requestUserName(req, req.query.usuario),
  );
  return res.json(data);
}

export async function handleCrearLibro(req: Request, res: Response) {
  const data = await crearLibro({
    ...(req.body ?? {}),
    usuario: requestUserName(
      req,
      req.body?.usuario ?? req.query.usuario,
    ),
  });
  return res.json(data);
}

export async function handleAnadirLibroExistente(req: Request, res: Response) {
  const data = await anadirLibroExistente(
    requestUserName(req, req.query.usuario),
    String(req.query.libro || ''),
    String(req.query.prioridad || ''),
    String(req.query.formato || ''),
  );

  return res.json(data);
}

export async function handleActualizarPreferenciasLibro(
  req: Request,
  res: Response,
) {
  const body = req.body ?? {};
  const data = await actualizarPreferenciasLibro(
    requestUserName(req, body.usuario ?? req.query.usuario),
    String(body.libro ?? req.query.libro ?? ''),
    String(body.prioridad ?? req.query.prioridad ?? ''),
    String(body.formato ?? req.query.formato ?? ''),
  );
  return res.json(data);
}

export async function handleIniciarLectura(req: Request, res: Response) {
  const data = await iniciarLectura(
    requestUserName(req, req.query.usuario),
    String(req.query.libro || ''),
  );

  return res.json(data);
}

export async function handleActualizarValoracion(req: Request, res: Response) {
  const data = await actualizarValoracion(
    requestUserName(req, req.query.usuario),
    String(req.query.libro || ''),
    String(req.query.valoracion || ''),
  );

  return res.json(data);
}

export async function handleActualizarEstado(req: Request, res: Response) {
  const body = req.body ?? {};

const data = await actualizarEstado(
  requestUserName(req, body.usuario || req.query.usuario),
  String(body.libro || req.query.libro || ''),
  String(body.estado || req.query.estado || ''),
  String(body.valoracion || req.query.valoracion || ''),
  String(body.reflexion || req.query.reflexion || ''),
  String(body.motivoPausa || req.query.motivoPausa || ''),
  String(body.fechaInicio || req.query.fechaInicio || ''),
  String(body.formato || req.query.formato || ''),
);

  return res.json(data);
}

export async function handleQuitarLibroPendientes(req: Request, res: Response) {
  const usuario = requestUserName(
    req,
    req.body?.usuario ?? req.query.usuario,
  );

  const libro = String(
    req.body?.libro ?? req.query.libro ?? '',
  );

  const data = await quitarLibroPendientes(
    usuario,
    libro,
  );

  return res.json(data);
}

export async function handleEditarLibro(
  req: Request,
  res: Response,
) {
  const data = await editarLibro({
    ...(req.body ?? {}),
    usuario: requestUserName(
      req,
      req.body?.usuario ?? req.query.usuario,
    ),
    bookId:
      req.body?.bookId ??
      req.query.bookId ??
      req.query.id ??
      '',
  });

  return res.json(data);
}
