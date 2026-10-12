import { Router } from 'express';

import { recibirFichaTalento } from '../services/talento-emergente.service.js';

/// Rutas públicas (sin sesión) del programa «Talento emergente».
export const talentoRouter = Router();

talentoRouter.post('/ficha', async (req, res, next) => {
  try {
    const resultado = await recibirFichaTalento(req.body ?? {}, req.ip ?? '');
    res.set('Cache-Control', 'no-store');
    if (resultado.ok) {
      return res.status(201).json({ ok: true });
    }
    return res.status(resultado.status).json({
      ok: false,
      error: resultado.error,
      mensaje: resultado.mensaje,
      ...(resultado.campos ? { campos: resultado.campos } : {}),
    });
  } catch (error) {
    return next(error);
  }
});
