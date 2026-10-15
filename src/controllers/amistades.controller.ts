import type { Request, Response } from 'express';

import { getFeedAmistades } from '../services/amistades-feed.service.js';
import {
  getActividadAmistades,
  getPerfilAmistad,
  guardarPrivacidadAmistades,
} from '../services/amistades-ver.service.js';
import {
  borrarComentarioProgreso,
  comentarProgreso,
  getComentariosProgreso,
  getResumenAmigosDeMiLectura,
} from '../services/amistades-comentarios.service.js';
import {
  crearLecturaConAmistad,
  enviarInvitacionLectura,
  getLecturasAmistades,
  responderLecturaAmistad,
  salirLecturaAmistad,
} from '../services/lecturas-amistades.service.js';
import { reservarRegalo } from '../services/amistades-regalos.service.js';
import { recomendarLibro } from '../services/amistades-recomendar.service.js';
import {
  buscarPersonas,
  cancelarSolicitudAmistad,
  getAmistades,
  quitarAmistad,
  responderAmistad,
  solicitarAmistad,
} from '../services/amistades.service.js';

function texto(req: Request, nombre: string) {
  return String(req.body?.[nombre] ?? '');
}

export async function handleAmistades(req: Request, res: Response) {
  return res.json(await getAmistades(req.auth!.userId));
}

export async function handleBuscarPersonas(req: Request, res: Response) {
  return res.json(await buscarPersonas(req.auth!.userId, String(req.query.q ?? '')));
}

export async function handleSolicitarAmistad(req: Request, res: Response) {
  return res.json(
    await solicitarAmistad(req.auth!.userId, {
      nombre: texto(req, 'nombre'),
      codigo: texto(req, 'codigo'),
    }),
  );
}

export async function handleResponderAmistad(req: Request, res: Response) {
  return res.json(
    await responderAmistad(req.auth!.userId, texto(req, 'nombre'), req.body?.aceptar === true),
  );
}

export async function handleCancelarSolicitudAmistad(req: Request, res: Response) {
  return res.json(await cancelarSolicitudAmistad(req.auth!.userId, texto(req, 'nombre')));
}

export async function handleQuitarAmistad(req: Request, res: Response) {
  return res.json(await quitarAmistad(req.auth!.userId, texto(req, 'nombre')));
}

export async function handlePerfilAmistad(req: Request, res: Response) {
  return res.json(await getPerfilAmistad(req.auth!.userId, String(req.query.nombre ?? '')));
}

export async function handleFeedAmistades(req: Request, res: Response) {
  return res.json(await getFeedAmistades(req.auth!.userId));
}

export async function handleActividadAmistades(req: Request, res: Response) {
  return res.json(await getActividadAmistades(req.auth!.userId));
}

export async function handleGuardarPrivacidadAmistades(req: Request, res: Response) {
  return res.json(
    await guardarPrivacidadAmistades(req.auth!.userId, {
      leyendo: req.body?.leyendo === true,
      biblioteca: req.body?.biblioteca === true,
      resenas: req.body?.resenas === true,
      deseos: typeof req.body?.deseos === 'boolean' ? req.body.deseos : undefined,
    }),
  );
}

export async function handleRecomendarLibro(req: Request, res: Response) {
  return res.json(
    await recomendarLibro(req.auth!.userId, {
      bookId: texto(req, 'bookId'),
      nombres: Array.isArray(req.body?.usuarios) ? req.body.usuarios.map(String) : [],
      mensaje: req.body?.mensaje,
      juntas: req.body?.juntas === true,
    }),
  );
}

export async function handleComentariosProgreso(req: Request, res: Response) {
  return res.json(await getComentariosProgreso(req.auth!.userId, String(req.query.libraryId ?? '')));
}

export async function handleComentarProgreso(req: Request, res: Response) {
  return res.json(await comentarProgreso(req.auth!.userId, texto(req, 'libraryId'), req.body?.texto));
}

export async function handleBorrarComentarioProgreso(req: Request, res: Response) {
  return res.json(await borrarComentarioProgreso(req.auth!.userId, texto(req, 'id')));
}

export async function handleCrearLecturaConAmistad(req: Request, res: Response) {
  return res.json(
    await crearLecturaConAmistad(req.auth!.userId, {
      bookId: texto(req, 'bookId'),
      nombre: texto(req, 'nombre'),
    }),
  );
}

export async function handleLecturasAmistades(req: Request, res: Response) {
  return res.json(await getLecturasAmistades(req.auth!.userId));
}

export async function handleResponderLecturaAmistad(req: Request, res: Response) {
  return res.json(
    await responderLecturaAmistad(req.auth!.userId, texto(req, 'clubId'), req.body?.aceptar === true),
  );
}

export async function handleReservarRegalo(req: Request, res: Response) {
  return res.json(await reservarRegalo(req.auth!.userId, texto(req, 'itemId'), req.body?.reservar !== false));
}

export async function handleSalirLecturaAmistad(req: Request, res: Response) {
  return res.json(
    await salirLecturaAmistad(req.auth!.userId, texto(req, 'clubId'), req.body?.eliminar === true),
  );
}

export async function handleEnviarInvitacionLectura(req: Request, res: Response) {
  return res.json(await enviarInvitacionLectura(req.auth!.userId, texto(req, 'clubId')));
}

export async function handleResumenAmigosLectura(req: Request, res: Response) {
  return res.json(await getResumenAmigosDeMiLectura(req.auth!.userId, String(req.query.bookId ?? '')));
}
