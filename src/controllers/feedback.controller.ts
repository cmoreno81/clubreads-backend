import type { Request, Response } from 'express';
import {
  enviarFeedback,
  type FeedbackCategory,
  type FeedbackImage,
} from '../services/feedback.service.js';
import { requestUserName } from '../middleware/auth.middleware.js';

const VALID_CATEGORIES = new Set<FeedbackCategory>(['bug', 'sugerencia', 'pregunta']);

// Límite defensivo: evita que un cliente adjunte decenas de capturas en una
// sola petición (payload enorme, muchas llamadas a la API de Jira en serie).
const MAX_IMAGES = 5;

function parseImages(body: unknown): FeedbackImage[] {
  if (!Array.isArray((body as { images?: unknown })?.images)) return [];
  const raw = (body as { images: unknown[] }).images;
  const images: FeedbackImage[] = [];
  for (const item of raw.slice(0, MAX_IMAGES)) {
    if (
      item &&
      typeof item === 'object' &&
      typeof (item as { base64?: unknown }).base64 === 'string' &&
      (item as { base64: string }).base64.trim()
    ) {
      const base64 = (item as { base64: string }).base64;
      const fileName =
        typeof (item as { fileName?: unknown }).fileName === 'string'
          ? (item as { fileName: string }).fileName
          : 'evidencia.jpg';
      images.push({ base64, fileName });
    }
  }
  return images;
}

export async function handleEnviarFeedback(req: Request, res: Response) {
  const category = String(req.body?.category || '').trim() as FeedbackCategory;
  const titulo = String(req.body?.titulo || '').trim();
  const descripcion = String(req.body?.descripcion || '').trim();
  const reporterEmail = String(req.body?.email || '').trim();
  const reporterName = String(req.body?.nombre || '').trim() || 'Lectora';
  const images = parseImages(req.body);

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
    images,
  });

  return res.json(result);
}
