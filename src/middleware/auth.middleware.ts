import type {
  NextFunction,
  Request,
  Response,
} from 'express';

import { prisma } from '../prisma.js';
import { verifyAccessToken } from '../services/auth-crypto.service.js';
import type { AccessTokenPayload } from '../services/auth-crypto.service.js';

type AuthenticatedSession = {
  id: string;
  userId: string;
  user: { name: string };
};

type SessionLookup = (
  where: {
    id: string;
    userId: string;
    revokedAt: null;
    expiresAt: { gt: Date };
  },
) => Promise<AuthenticatedSession | null>;

export async function findActiveAccessSession(
  payload: AccessTokenPayload,
  lookup: SessionLookup = (where) =>
    prisma.authSession.findFirst({
      where,
      select: {
        id: true,
        userId: true,
        user: { select: { name: true } },
      },
    }),
) {
  return lookup({
    id: payload.sid,
    userId: payload.sub,
    revokedAt: null,
    expiresAt: { gt: new Date() },
  });
}

export async function authenticateOptional(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const authorization = req.get('authorization')?.trim();
  if (!authorization) return next();

  const match = /^Bearer\s+(.+)$/i.exec(authorization);
  const payload = match ? await verifyAccessToken(match[1]!) : null;
  if (!payload) {
    return res.status(401).json({
      ok: false,
      error: 'INVALID_ACCESS_TOKEN',
      mensaje: 'La sesión no es válida o ha caducado',
    });
  }

  const session = await findActiveAccessSession(payload);
  if (!session) {
    return res.status(401).json({
      ok: false,
      error: 'INVALID_ACCESS_TOKEN',
      mensaje: 'La sesión no es válida o ha caducado',
    });
  }

  req.auth = {
    userId: session.userId,
    userName: session.user.name,
    sessionId: session.id,
  };
  return next();
}

export function requireAuthentication(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  if (!req.auth) {
    return res.status(401).json({
      ok: false,
      error: 'AUTHENTICATION_REQUIRED',
      mensaje: 'Necesitas iniciar sesión',
    });
  }
  return next();
}

export function requestUserName(
  req: Request,
  _legacyValue: unknown = '',
) {
  return req.auth?.userName ?? '';
}
