import type { Request, Response } from 'express';
import { getAutoraDeLaSemana } from '../services/talento-emergente-destacada.service.js';

export async function handleAutoraDeLaSemana(_req: Request, res: Response) {
  try {
    return res.json(await getAutoraDeLaSemana());
  } catch (error) {
    return res.status(500).json({
      ok: false,
      mensaje: error instanceof Error ? error.message : 'Error inesperado',
    });
  }
}
