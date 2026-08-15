import type { Request, Response } from 'express';
import { requestUserName } from '../middleware/auth.middleware.js';
import {
  ClubBookOfYearError,
  closeClubBookOfYearQualifying,
  closeClubBookOfYearRound,
  getClubBookOfYear,
  getClubBookOfYearHistory,
  openClubBookOfYearRound,
  prepareClubBookOfYear,
  startClubBookOfYear,
  voteClubBookOfYearDuel,
  voteClubBookOfYearQualifying,
  cancelClubBookOfYear,
} from '../services/club-book-of-year.service.js';

const year = (req: Request) => Number(req.body?.anio ?? req.query.anio);
async function send(res: Response, operation: () => Promise<unknown>) {
  try { return res.json(await operation()); }
  catch (error) {
    if (error instanceof ClubBookOfYearError) return res.status(error.statusCode).json({ ok: false, error: error.code, mensaje: error.message });
    throw error;
  }
}
export const handleGetClubBookOfYear = (req: Request, res: Response) => send(res, () => getClubBookOfYear(requestUserName(req), year(req)));
export const handlePrepareClubBookOfYear = (req: Request, res: Response) => send(res, () => prepareClubBookOfYear(requestUserName(req), year(req)));
export const handleStartClubBookOfYear = (req: Request, res: Response) => send(res, () => startClubBookOfYear(requestUserName(req), year(req)));
export const handleVoteClubBookOfYearQualifying = (req: Request, res: Response) => send(res, () => voteClubBookOfYearQualifying(requestUserName(req), year(req), req.body.candidateIds));
export const handleCloseClubBookOfYearQualifying = (req: Request, res: Response) => send(res, () => closeClubBookOfYearQualifying(requestUserName(req), year(req)));
export const handleOpenClubBookOfYearRound = (req: Request, res: Response) => send(res, () => openClubBookOfYearRound(requestUserName(req), year(req), req.body.roundId));
export const handleVoteClubBookOfYearDuel = (req: Request, res: Response) => send(res, () => voteClubBookOfYearDuel(requestUserName(req), year(req), req.body.duelId, req.body.candidateId));
export const handleCloseClubBookOfYearRound = (req: Request, res: Response) => send(res, () => closeClubBookOfYearRound(requestUserName(req), year(req), req.body.roundId));
export const handleGetClubBookOfYearHistory = (req: Request, res: Response) => send(res, () => getClubBookOfYearHistory(requestUserName(req)));
export const handleCancelClubBookOfYear = (req: Request, res: Response) => send(res, () => cancelClubBookOfYear(requestUserName(req), year(req)));
