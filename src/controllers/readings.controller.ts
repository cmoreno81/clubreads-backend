import type { Request, Response } from 'express';
import {
  getLecturasActivas,
  crearLectura,
  getConfiguracionLectura,
  getComentariosLectura,
  getComentariosLecturaPage,
  enviarComentarioLectura,
  responderComentarioLectura,
  toggleLikeComentario,
  editarComentarioLectura,
  eliminarComentarioLectura,
  editarRespuestaLectura,
  eliminarRespuestaLectura,
  getConversacionesLibro,
  getConversacionesLibroPage,
  marcarConversacionVista,
} from '../services/readings.service.js';
import { requestUserName } from '../middleware/auth.middleware.js';
import {
  hasExplicitPagination,
  parsePagination,
} from '../utils/cursor-pagination.js';
import { logger } from '../logging/logger.js';

export async function handleLecturasActivas(req: Request, res: Response) {
  res.set({
    'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
    Pragma: 'no-cache',
    Expires: '0',
  });
  const data = await getLecturasActivas(
    requestUserName(req),
  );
  return res.json(data);
}

export async function handleCrearLectura(req: Request, res: Response) {
  const body = req.body ?? {};
  const data = await crearLectura({
    usuario: requestUserName(req),
    libro: String(body.libro || ''),
    capitulos: Number(body.capitulos || 0),
    prologo:
      String(body.prologo || '') === '1' || body.prologo === true,
    epilogo:
      String(body.epilogo || '') === '1' || body.epilogo === true,
    paginas:
      body.paginas === undefined ? undefined : Number(body.paginas),
    tipo: String(body.tipo || 'LIBRE'),
  });

  return res.json(data);
}

export async function handleConfiguracionLectura(
  req: Request,
  res: Response,
) {
  const data = await getConfiguracionLectura(
    String(req.query.libro || ''),
    requestUserName(req),
  );

  return res.json(data);
}

export async function handleComentariosLectura(req: Request, res: Response) {
  if (hasExplicitPagination(req.query)) {
    const cutoff = req.query.cutoff ? String(req.query.cutoff) : null;
    return res.json(
      await getComentariosLecturaPage(
        String(req.query.libro || ''),
        String(req.query.capitulo || ''),
        requestUserName(req),
        parsePagination(req.query),
        cutoff,
      ),
    );
  }
  const data = await getComentariosLectura(
    String(req.query.libro || ''),
    String(req.query.capitulo || ''),
    requestUserName(req),
  );

  return res.json(data);
}

export async function handleGuardarComentarioLectura(
  req: Request,
  res: Response,
) {
  const body = req.body ?? {};
  const usuario = requestUserName(req);
  const libro = String(body.libro || '');
  const capitulo = String(body.capitulo || '');
  const comentarioText = String(body.comentario || body.texto || '');

  logger.info({
    event: 'comment_save_attempt',
    usuario,
    libro,
    capitulo,
    comentarioLength: comentarioText.length,
    userId: req.auth?.userId,
    sessionId: req.auth?.sessionId,
    requestId: res.locals.requestId,
  }, `[debug] guardarComentarioLectura: usuario="${usuario}" libro="${libro}" capitulo="${capitulo}"`);

  const data = await enviarComentarioLectura({
    libro,
    capitulo,
    usuario,
    comentario: comentarioText,
    tipo: String(body.tipo || 'COMMENT'),
    color: String(body.color || ''),
  });

  logger.info({
    event: 'comment_save_result',
    ok: data.ok,
    usuario,
    libro,
    capitulo,
    commentId: data.ok ? (data as { comentario?: { id?: string } }).comentario?.id : undefined,
    requestId: res.locals.requestId,
  }, `[debug] guardarComentarioLectura resultado: ok=${data.ok}`);

  return res.json(data);
}

export async function handleResponderComentario(req: Request, res: Response) {
  const data = await responderComentarioLectura({
    comentarioId: String(req.body?.comentarioId || ''),
    usuario: requestUserName(req),
    respuesta: String(req.body?.respuesta || ''),
  });

  return res.json(data);
}

export async function handleToggleLikeComentario(req: Request, res: Response) {
  const data = await toggleLikeComentario(
    String(req.body?.comentarioId || req.body?.id || ''),
    requestUserName(req),
    String(req.body?.reaccion || 'LIKE'),
  );

  return res.json(data);
}

export async function handleEditarComentario(req: Request, res: Response) {
  const data = await editarComentarioLectura(
    String(req.body?.comentarioId || req.body?.id || ''),
    String(req.body?.comentario || ''),
    requestUserName(req),
  );

  

  return res.json(data);
}

export async function handleEliminarComentario(req: Request, res: Response) {
  const data = await eliminarComentarioLectura(
    String(req.body?.comentarioId || req.body?.id || ''),
    requestUserName(req),
  );

  return res.json(data);
}

export async function handleEditarRespuesta(req: Request, res: Response) {
  const data = await editarRespuestaLectura(
    String(req.body?.respuestaId || req.body?.id || ''),
    String(req.body?.respuesta || ''),
    requestUserName(req),
  );

  return res.json(data);
}

export async function handleEliminarRespuesta(req: Request, res: Response) {
  const data = await eliminarRespuestaLectura(
    String(req.body?.respuestaId || req.body?.id || ''),
    requestUserName(req),
  );

  return res.json(data);
}

export async function handleConversacionesLibro(req: Request, res: Response) {
  if (hasExplicitPagination(req.query)) {
    return res.json(
      await getConversacionesLibroPage(
        String(req.query.libro || ''),
        requestUserName(req),
        parsePagination(req.query),
      ),
    );
  }
  const data = await getConversacionesLibro(
    String(req.query.libro || ''),
    requestUserName(req),
  );
  return res.json(data);
}

export async function handleMarcarConversacionVista(
  req: Request,
  res: Response,
) {
  const data = await marcarConversacionVista({
    libro: String(req.body?.libro || ''),
    capitulo: String(req.body?.capitulo || ''),
    usuario: requestUserName(req),
  });

  return res.json(data);
}
