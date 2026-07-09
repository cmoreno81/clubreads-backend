import type { Request, Response } from 'express';
import { getPerfilUsuario } from '../services/perfil.service.js';

export async function handlePerfilUsuario(req: Request, res: Response) {
  const data = await getPerfilUsuario(String(req.query.usuario || ''));
  return res.json(data);
}