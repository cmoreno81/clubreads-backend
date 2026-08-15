import type { Request, Response } from 'express';

import { requestUserName } from '../middleware/auth.middleware.js';
import {
  getReactionDetails,
  type ReactionTargetType,
} from '../services/reaction-details.service.js';

export async function handleReactionDetails(req: Request, res: Response) {
  const result = await getReactionDetails(
    String(req.query.targetType) as ReactionTargetType,
    String(req.query.targetId),
    requestUserName(req),
  );
  return res.status(result.ok ? 200 : 404).json(result);
}
