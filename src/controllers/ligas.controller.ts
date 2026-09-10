import type { Request, Response } from 'express';

import {
  getLiga,
  salirDeLaLiga,
  unirseALaLiga,
} from '../services/ligas.service.js';

export async function handleGetLiga(req: Request, res: Response) {
  const userId = req.auth!.userId;
  return res.json(await getLiga(userId));
}

export async function handleUnirseLiga(req: Request, res: Response) {
  const userId = req.auth!.userId;
  await unirseALaLiga(userId);
  return res.json(await getLiga(userId));
}

export async function handleSalirLiga(req: Request, res: Response) {
  const userId = req.auth!.userId;
  await salirDeLaLiga(userId);
  return res.json({ ok: true, participando: false });
}
