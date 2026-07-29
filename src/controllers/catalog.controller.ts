import type { Request, Response } from 'express';

import { requestUserName } from '../middleware/auth.middleware.js';
import {
  getGeneralCatalog,
  importCatalogBook,
  searchGeneralCatalog,
} from '../services/catalog.service.js';

export async function handleGeneralCatalog(req: Request, res: Response) {
  return res.json(await getGeneralCatalog(requestUserName(req)));
}

export async function handleSearchGeneralCatalog(req: Request, res: Response) {
  return res.json(
    await searchGeneralCatalog(
      requestUserName(req),
      String(req.query.q ?? ''),
    ),
  );
}

export async function handleImportCatalogBook(req: Request, res: Response) {
  return res.json(
    await importCatalogBook(
      requestUserName(req),
      (req.body ?? {}) as Record<string, unknown>,
    ),
  );
}
