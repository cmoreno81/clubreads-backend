import type { Request, Response } from 'express';

import {
  getHiddenUserSeries,
  hideUserSeries,
  showUserSeries,
} from '../services/hidden-user-series.service.js';

export async function handleGetHiddenSeries(req: Request, res: Response) {
  return res.json(await getHiddenUserSeries(req.auth!.userId));
}

export async function handleHideSeries(req: Request, res: Response) {
  return res.json(await hideUserSeries(req.auth!.userId, req.body?.sagaId));
}

export async function handleShowSeries(req: Request, res: Response) {
  return res.json(await showUserSeries(req.auth!.userId, req.body?.sagaId));
}
