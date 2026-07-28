import type {
  NextFunction,
  Request,
  Response,
} from 'express';

import { prisma } from '../prisma.js';
import { verifyAccessToken } from '../services/auth-crypto.service.js';

export async function authenticateOptional(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const authorization = req.get('authorization')?.trim();
  if (!authorization) return next();

  const match = /^Bearer\s+(.+)$/i.exec(authorization);
  const payload = match ? verifyAccessToken(match[1]!) : null;
  if (!payload) {
    return res.status(401).json({
      ok: false,
      error: 'INVALID_ACCESS_TOKEN',
      mensaje: 'La sesión no es válida o ha caducado',
    });
  }

  const session = await prisma.authSession.findFirst({
    where: {
      id: payload.sid,
      userId: payload.sub,
      revokedAt: null,
      expiresAt: { gt: new Date() },
    },
    include: { user: true },
  });
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
  legacyValue: unknown = '',
) {
  return req.auth?.userName ?? String(legacyValue ?? '');
}
