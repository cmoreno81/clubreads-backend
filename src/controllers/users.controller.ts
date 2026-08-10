import type { Request, Response } from 'express';
import { getUsuarios } from '../services/users.service.js';
import { requestUserName } from '../middleware/auth.middleware.js';

export async function handleUsuarios(req: Request, res: Response) {
  const data = await getUsuarios(
    requestUserName(req),
  );
  return res.json(data);
}
