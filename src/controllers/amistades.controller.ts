import type { Request, Response } from 'express';

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
