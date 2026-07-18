import type { Request, Response } from 'express';
import {
  getLecturasActivas,
  crearLectura,
  getConfiguracionLectura,
  getComentariosLectura,
  enviarComentarioLectura,
  responderComentarioLectura,
  toggleLikeComentario,
  editarComentarioLectura,
  eliminarComentarioLectura,
  editarRespuestaLectura,
  eliminarRespuestaLectura,
  getConversacionesLibro,
  marcarConversacionVista,
} from '../services/readings.service.js';

export async function handleLecturasActivas(_req: Request, res: Response) {
  res.set({
    'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
    Pragma: 'no-cache',
    Expires: '0',
  });
  const data = await getLecturasActivas();
  return res.json(data);
}

export async function handleCrearLectura(req: Request, res: Response) {
  const data = await crearLectura({
    libro: String(req.query.libro || req.body?.libro || ''),
    capitulos: Number(req.query.capitulos || req.body?.capitulos || 0),
    prologo:
      String(req.query.prologo || req.body?.prologo || '') === '1' ||
      req.body?.prologo === true,
    epilogo:
      String(req.query.epilogo || req.body?.epilogo || '') === '1' ||
      req.body?.epilogo === true,
    tipo: String(req.query.tipo || req.body?.tipo || 'LIBRE'),
  });

  return res.json(data);
}

export async function handleConfiguracionLectura(
  req: Request,
  res: Response,
) {
  const data = await getConfiguracionLectura(
    String(req.query.libro || ''),
    String(req.query.usuario || ''),
  );

  return res.json(data);
}

export async function handleComentariosLectura(req: Request, res: Response) {
  const data = await getComentariosLectura(
    String(req.query.libro || ''),
    String(req.query.capitulo || ''),
    String(req.query.usuario || ''),
  );

  return res.json(data);
}

export async function handleGuardarComentarioLectura(
  req: Request,
  res: Response,
) {
  const data = await enviarComentarioLectura({
    libro: String(req.query.libro || req.body?.libro || ''),
    capitulo: String(req.query.capitulo || req.body?.capitulo || ''),
    usuario: String(req.query.usuario || req.body?.usuario || ''),
    comentario: String(
      req.query.comentario ||
        req.body?.comentario ||
        req.body?.texto ||
        '',
    ),
  });

  return res.json(data);
}

export async function handleResponderComentario(req: Request, res: Response) {
  const data = await responderComentarioLectura({
    comentarioId: String(req.query.comentarioId || req.body?.comentarioId || ''),
    usuario: String(req.query.usuario || req.body?.usuario || ''),
    respuesta: String(req.query.respuesta || req.body?.respuesta || ''),
  });

  return res.json(data);
}

export async function handleToggleLikeComentario(req: Request, res: Response) {
  const data = await toggleLikeComentario(
    String(req.query.comentarioId || req.query.id || req.body?.comentarioId || req.body?.id || ''),
    String(req.query.usuario || req.body?.usuario || ''),
    String(req.query.reaccion || req.body?.reaccion || 'LIKE'),
  );

  return res.json(data);
}

export async function handleEditarComentario(req: Request, res: Response) {
  const data = await editarComentarioLectura(
    String(
      req.query.comentarioId ||
        req.query.id ||
        req.body?.comentarioId ||
        req.body?.id ||
        '',
    ),
    String(req.query.comentario || req.body?.comentario || ''),
  );

  

  return res.json(data);
}

export async function handleEliminarComentario(req: Request, res: Response) {
  const data = await eliminarComentarioLectura(
    String(
      req.query.comentarioId ||
        req.query.id ||
        req.body?.comentarioId ||
        req.body?.id ||
        '',
    ),
  );

  return res.json(data);
}

export async function handleEditarRespuesta(req: Request, res: Response) {
  const data = await editarRespuestaLectura(
    String(req.query.respuestaId || req.query.id || req.body?.respuestaId || req.body?.id || ''),
    String(req.query.respuesta || req.body?.respuesta || ''),
  );

  return res.json(data);
}

export async function handleEliminarRespuesta(req: Request, res: Response) {
  const data = await eliminarRespuestaLectura(
    String(req.query.respuestaId || req.query.id || req.body?.respuestaId || req.body?.id || ''),
  );

  return res.json(data);
}

export async function handleConversacionesLibro(req: Request, res: Response) {
  const data = await getConversacionesLibro(String(req.query.libro || ''));
  return res.json(data);
}

export async function handleMarcarConversacionVista(
  req: Request,
  res: Response,
) {
  const data = await marcarConversacionVista({
    libro: String(req.query.libro || req.body?.libro || ''),
    capitulo: String(req.query.capitulo || req.body?.capitulo || ''),
    usuario: String(req.query.usuario || req.body?.usuario || ''),
  });

  return res.json(data);
}
