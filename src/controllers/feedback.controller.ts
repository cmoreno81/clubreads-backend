import type { Request, Response } from 'express';
import { enviarFeedback, type FeedbackCategory } from '../services/feedback.service.js';
import { requestUserName } from '../middleware/auth.middleware.js';

const VALID_CATEGORIES = new Set<FeedbackCategory>(['bug', 'sugerencia', 'pregunta']);

export async function handleEnviarFeedback(req: Request, res: Response) {
  const category = String(req.body?.category || '').trim() as FeedbackCategory;
  const titulo = String(req.body?.titulo || '').trim();
  const descripcion = String(req.body?.descripcion || '').trim();
  const reporterEmail = String(req.body?.email || '').trim();
  const reporterName = String(req.body?.nombre || '').trim() || 'Lectora';

  if (!VALID_CATEGORIES.has(category)) {
    return res.status(400).json({ ok: false, error: 'VALIDATION_ERROR', mensaje: 'Categoría no válida' });
  }
  if (!titulo || titulo.length > 200) {
    return res.status(400).json({ ok: false, error: 'VALIDATION_ERROR', mensaje: 'El título es obligatorio (máx. 200 caracteres)' });
  }
  if (!descripcion || descripcion.length > 2000) {
    return res.status(400).json({ ok: false, error: 'VALIDATION_ERROR', mensaje: 'La descripción es obligatoria (máx. 2000 caracteres)' });
  }

  // Si hay sesión activa, podemos enriquecer con el username del perfil
  const sessionUser = requestUserName(req);

  const result = await enviarFeedback({
    reporterEmail,
    reporterName: sessionUser || reporterName,
    category,
    titulo,
    descripcion,
  });

  return res.json(result);
}
