import type { Request, Response } from 'express';
import { BookOfYearDuelPhase } from '@prisma/client';
import {
  BookOfYearError,
  chooseAnnualBookOfYear,
  chooseBookOfYearDuel,
  getClubBooksOfYear,
  getMyBookOfYear,
  getPublicBookOfYear,
  saveMonthlyBookOfYear,
} from '../services/book-of-year.service.js';

function yearFrom(value: unknown) { return Number(value ?? new Date().getFullYear()); }
function fail(res: Response, error: unknown) {
  if (error instanceof BookOfYearError) return res.status(error.code === 'FORBIDDEN' ? 403 : 400).json({ ok: false, error: error.code, mensaje: error.message });
  throw error;
}

export async function handleGetMyBookOfYear(req: Request, res: Response) {
  try { return res.json(await getMyBookOfYear(req.auth!.userId, yearFrom(req.query.anio))); } catch (error) { return fail(res, error); }
}
export async function handleSaveMonthlyBookOfYear(req: Request, res: Response) {
  try { return res.json(await saveMonthlyBookOfYear(req.auth!.userId, Number(req.body.anio), Number(req.body.mes), String(req.body.bookId))); } catch (error) { return fail(res, error); }
}
export async function handleChooseBookOfYearDuel(req: Request, res: Response) {
  try { return res.json(await chooseBookOfYearDuel(req.auth!.userId, Number(req.body.anio), req.body.fase as BookOfYearDuelPhase, Number(req.body.posicion), String(req.body.bookId))); } catch (error) { return fail(res, error); }
}
export async function handleChooseAnnualBookOfYear(req: Request, res: Response) {
  try { return res.json(await chooseAnnualBookOfYear(req.auth!.userId, Number(req.body.anio), String(req.body.bookId))); } catch (error) { return fail(res, error); }
}
export async function handleGetPublicBookOfYear(req: Request, res: Response) {
  try {
    const profile = req.query.perfil ? String(req.query.perfil) : '';
    const profileId = req.query.profileUserId ? String(req.query.profileUserId) : undefined;
    return res.json(await getPublicBookOfYear(req.auth!.userId, profile, yearFrom(req.query.anio), new Date(), profileId));
  } catch (error) { return fail(res, error); }
}
export async function handleGetClubBooksOfYear(req: Request, res: Response) {
  try { return res.json(await getClubBooksOfYear(req.auth!.userName, yearFrom(req.query.anio))); } catch (error) { return fail(res, error); }
}
