import type { Request, Response } from 'express';
import { getUsuarios } from '../services/users.service.js';

export async function handleUsuarios(_req: Request, res: Response) {
  const data = await getUsuarios();
  return res.json(data);
}