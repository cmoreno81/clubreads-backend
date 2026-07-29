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
import { requestUserName } from '../middleware/auth.middleware.js';

export async function handleLecturasActivas(req: Request, res: Response) {
  res.set({
    'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
    Pragma: 'no-cache',
    Expires: '0',
  });
  const data = await getLecturasActivas(
    requestUserName(req, req.query.usuario),
  );
  return res.json(data);
}

export async function handleCrearLectura(req: Request, res: Response) {
  const data = await crearLectura({
    usuario: requestUserName(
      req,
      req.body?.usuario ?? req.query.usuario,
    ),
    libro: String(req.query.libro || req.body?.libro || ''),
    capitulos: Number(req.query.capitulos || req.body?.capitulos || 0),
    prologo:
      String(req.query.prologo || req.body?.prologo || '') === '1' ||
      req.body?.prologo === true,
    epilogo:
      String(req.query.epilogo || req.body?.epilogo || '') === '1' ||
      req.body?.epilogo === true,
    paginas:
      req.query.paginas === undefined && req.body?.paginas === undefined
        ? undefined
        : Number(req.query.paginas ?? req.body?.paginas),
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
    requestUserName(req, req.query.usuario),
  );

  return res.json(data);
}

export async function handleComentariosLectura(req: Request, res: Response) {
  const data = await getComentariosLectura(
    String(req.query.libro || ''),
    String(req.query.capitulo || ''),
    requestUserName(req, req.query.usuario),
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
    usuario: requestUserName(
      req,
      req.body?.usuario ?? req.query.usuario,
    ),
    comentario: String(
      req.query.comentario ||
        req.body?.comentario ||
        req.body?.texto ||
        '',
    ),
    tipo: String(req.query.tipo || req.body?.tipo || 'COMMENT'),
    color: String(req.query.color || req.body?.color || ''),
  });

  return res.json(data);
}

export async function handleResponderComentario(req: Request, res: Response) {
  const data = await responderComentarioLectura({
    comentarioId: String(req.query.comentarioId || req.body?.comentarioId || ''),
    usuario: requestUserName(
      req,
      req.body?.usuario ?? req.query.usuario,
    ),
    respuesta: String(req.query.respuesta || req.body?.respuesta || ''),
  });

  return res.json(data);
}

export async function handleToggleLikeComentario(req: Request, res: Response) {
  const data = await toggleLikeComentario(
    String(req.query.comentarioId || req.query.id || req.body?.comentarioId || req.body?.id || ''),
    requestUserName(
      req,
      req.body?.usuario ?? req.query.usuario,
    ),
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
    requestUserName(
      req,
      req.body?.usuario ?? req.query.usuario,
    ),
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
    requestUserName(
      req,
      req.body?.usuario ?? req.query.usuario,
    ),
  );

  return res.json(data);
}

export async function handleEditarRespuesta(req: Request, res: Response) {
  const data = await editarRespuestaLectura(
    String(req.query.respuestaId || req.query.id || req.body?.respuestaId || req.body?.id || ''),
    String(req.query.respuesta || req.body?.respuesta || ''),
    requestUserName(
      req,
      req.body?.usuario ?? req.query.usuario,
    ),
  );

  return res.json(data);
}

export async function handleEliminarRespuesta(req: Request, res: Response) {
  const data = await eliminarRespuestaLectura(
    String(req.query.respuestaId || req.query.id || req.body?.respuestaId || req.body?.id || ''),
    requestUserName(
      req,
      req.body?.usuario ?? req.query.usuario,
    ),
  );

  return res.json(data);
}

export async function handleConversacionesLibro(req: Request, res: Response) {
  const data = await getConversacionesLibro(
    String(req.query.libro || ''),
    requestUserName(req, req.query.usuario),
  );
  return res.json(data);
}

export async function handleMarcarConversacionVista(
  req: Request,
  res: Response,
) {
  const data = await marcarConversacionVista({
    libro: String(req.query.libro || req.body?.libro || ''),
    capitulo: String(req.query.capitulo || req.body?.capitulo || ''),
    usuario: requestUserName(
      req,
      req.body?.usuario ?? req.query.usuario,
    ),
  });

  return res.json(data);
}
