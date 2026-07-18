import type { Request, Response } from 'express';
import {
  getLibros,
  getLibrosFinalizados,
  anadirLibroExistente,
  iniciarLectura,
  actualizarEstado,
  actualizarValoracion,
  crearLibro,
  quitarLibroPendientes,
  editarLibro,
  actualizarProgresoLectura,
} from '../services/books.service.js';

export async function handleLibros(req: Request, res: Response) {
  const data = await getLibros(String(req.query.usuario || ''));
  return res.json(data);
}

export async function handleActualizarProgresoLectura(
  req: Request,
  res: Response,
) {
  const body = req.body ?? {};
  const data = await actualizarProgresoLectura(
    String(body.usuario ?? req.query.usuario ?? ''),
    String(body.libro ?? req.query.libro ?? ''),
    Number(body.progreso ?? req.query.progreso ?? 0),
    String(body.comentario ?? req.query.comentario ?? ''),
    body.paginaActual === undefined && req.query.paginaActual === undefined
      ? undefined
      : Number(body.paginaActual ?? req.query.paginaActual),
  );
  return res.json(data);
}

export async function handleLibrosFinalizados(_req: Request, res: Response) {
  const data = await getLibrosFinalizados();
  return res.json(data);
}

export async function handleCrearLibro(req: Request, res: Response) {
  const data = await crearLibro(req.body ?? {});
  return res.json(data);
}

export async function handleAnadirLibroExistente(req: Request, res: Response) {
  const data = await anadirLibroExistente(
    String(req.query.usuario || ''),
    String(req.query.libro || ''),
  );

  return res.json(data);
}

export async function handleIniciarLectura(req: Request, res: Response) {
  const data = await iniciarLectura(
    String(req.query.usuario || ''),
    String(req.query.libro || ''),
  );

  return res.json(data);
}

export async function handleActualizarValoracion(req: Request, res: Response) {
  const data = await actualizarValoracion(
    String(req.query.usuario || ''),
    String(req.query.libro || ''),
    String(req.query.valoracion || ''),
  );

  return res.json(data);
}

export async function handleActualizarEstado(req: Request, res: Response) {
  const body = req.body ?? {};

const data = await actualizarEstado(
  String(body.usuario || req.query.usuario || ''),
  String(body.libro || req.query.libro || ''),
  String(body.estado || req.query.estado || ''),
  String(body.valoracion || req.query.valoracion || ''),
  String(body.reflexion || req.query.reflexion || ''),
  String(body.motivoPausa || req.query.motivoPausa || ''),
  String(body.fechaInicio || req.query.fechaInicio || ''),
);

  return res.json(data);
}

export async function handleQuitarLibroPendientes(req: Request, res: Response) {
  const usuario = String(
    req.body?.usuario ?? req.query.usuario ?? '',
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
    bookId:
      req.body?.bookId ??
      req.query.bookId ??
      req.query.id ??
      '',
  });

  return res.json(data);
}
