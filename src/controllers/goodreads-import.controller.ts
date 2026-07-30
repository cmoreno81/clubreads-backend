import type { Request, Response } from 'express';

import { requestUserName } from '../middleware/auth.middleware.js';
import {
  confirmGoodreadsImport,
  previewGoodreadsImport,
} from '../services/goodreads-import.service.js';

export async function handlePreviewGoodreadsImport(
  req: Request,
  res: Response,
) {
  return res.json(
    await previewGoodreadsImport(requestUserName(req), req.body?.libros),
  );
}

export async function handleConfirmGoodreadsImport(
  req: Request,
  res: Response,
) {
  return res.json(
    await confirmGoodreadsImport(requestUserName(req), req.body?.libros),
  );
}
