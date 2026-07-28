import { randomInt } from 'node:crypto';
import { AuthCodePurpose } from '@prisma/client';

import { prisma } from '../prisma.js';
import {
  createAccessToken,
  generateRefreshToken,
  hashAuthCode,
  hashPassword,
  hashRefreshToken,
  normalizeEmail,
  safeEqualText,
  validatePassword,
  verifyPassword,
} from './auth-crypto.service.js';
import { sendAuthCodeEmail } from './auth-email.service.js';

const CODE_TTL_MS = 10 * 60 * 1000;
const CODE_RESEND_DELAY_MS = 60 * 1000;
const MAX_CODES_PER_HOUR = 5;
const MAX_CODE_ATTEMPTS = 5;
const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const LOGIN_LOCK_MS = 15 * 60 * 1000;
const GENERIC_CODE_RESPONSE = {
  ok: true,
  mensaje:
    'Si el correo está dado de alta, recibirás un código en unos minutos.',
};

export class AuthError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly code: string,
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

function validateEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

async function issueSession(userId: string) {
  const provisionalToken = generateRefreshToken('new');
  const session = await prisma.authSession.create({
    data: {
      userId,
      refreshTokenHash: hashRefreshToken(provisionalToken),
      expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
    },
    include: {
      user: {
        include: {
          activeClub: true,
          clubMemberships: {
            include: { club: true },
          },
        },
      },
    },
  });
  const refreshToken = generateRefreshToken(session.id);

  await prisma.authSession.update({
    where: { id: session.id },
    data: {
      refreshTokenHash: hashRefreshToken(refreshToken),
    },
  });

  return {
    ok: true,
    accessToken: createAccessToken(userId, session.id),
    refreshToken,
    expiresIn: 15 * 60,
    usuario: {
      id: session.user.id,
      nombre: session.user.name,
      email: session.user.email,
      avatarUrl: session.user.avatarUrl ?? '',
      activeClub: session.user.activeClub
        ? {
            id: session.user.activeClub.id,
            nombre: session.user.activeClub.name,
            slug: session.user.activeClub.slug,
          }
        : null,
      clubs: session.user.clubMemberships.map((membership) => ({
        id: membership.club.id,
        nombre: membership.club.name,
        slug: membership.club.slug,
        rol: membership.role,
      })),
    },
  };
}

async function requestCode(
  rawEmail: string,
  purpose: AuthCodePurpose,
) {
  const email = normalizeEmail(rawEmail);
  if (!validateEmail(email)) return GENERIC_CODE_RESPONSE;

  const user = await prisma.user.findFirst({
    where: {
      email: { equals: email, mode: 'insensitive' },
    },
  });

  if (
    !user ||
    (purpose === AuthCodePurpose.ACTIVATE && user.passwordHash) ||
    (purpose === AuthCodePurpose.RESET_PASSWORD && !user.passwordHash)
  ) {
    return GENERIC_CODE_RESPONSE;
  }

  const now = new Date();
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
  const code = randomInt(0, 1_000_000)
    .toString()
    .padStart(6, '0');

  const authCode = await prisma.$transaction(async (tx) => {
    const requestLockKey = `${user.id}:${purpose}:request`;
    await tx.$queryRaw`
      SELECT pg_advisory_xact_lock(hashtextextended(${requestLockKey}, 0))
    `;
    const [latest, recentCount] = await Promise.all([
      tx.authCode.findFirst({
        where: { userId: user.id, purpose },
        orderBy: { createdAt: 'desc' },
      }),
      tx.authCode.count({
        where: {
          userId: user.id,
          purpose,
          createdAt: { gte: oneHourAgo },
        },
      }),
    ]);

    if (
      recentCount >= MAX_CODES_PER_HOUR ||
      (latest &&
        now.getTime() - latest.createdAt.getTime() <
          CODE_RESEND_DELAY_MS)
    ) {
      return null;
    }

    await tx.authCode.updateMany({
      where: {
        userId: user.id,
        purpose,
        consumedAt: null,
      },
      data: { consumedAt: now },
    });

    return tx.authCode.create({
      data: {
        userId: user.id,
        purpose,
        codeHash: hashAuthCode(user.id, purpose, code),
        expiresAt: new Date(now.getTime() + CODE_TTL_MS),
      },
    });
  });
  if (!authCode) return GENERIC_CODE_RESPONSE;

  try {
    await sendAuthCodeEmail({
      to: user.email,
      name: user.name,
      code,
      purpose,
      idempotencyKey: `auth-code-${authCode.id}`,
    });
  } catch (error) {
    await prisma.authCode.deleteMany({
      where: { id: authCode.id, consumedAt: null },
    });
    console.error('No se pudo entregar un código de acceso', error);
    return GENERIC_CODE_RESPONSE;
  }

  return GENERIC_CODE_RESPONSE;
}

async function consumeCodeAndSetPassword(params: {
  rawEmail: string;
  code: string;
  password: string;
  purpose: AuthCodePurpose;
}) {
  const email = normalizeEmail(params.rawEmail);
  const passwordError = validatePassword(params.password);
  if (passwordError) {
    throw new AuthError(passwordError, 400, 'INVALID_PASSWORD');
  }

  const user = await prisma.user.findFirst({
    where: { email: { equals: email, mode: 'insensitive' } },
  });
  if (!user) {
    throw new AuthError(
      'Código no válido o caducado',
      400,
      'INVALID_CODE',
    );
  }
  if (
    (params.purpose === AuthCodePurpose.ACTIVATE &&
      user.passwordHash) ||
    (params.purpose === AuthCodePurpose.RESET_PASSWORD &&
      !user.passwordHash)
  ) {
    throw new AuthError(
      'Código no válido o caducado',
      400,
      'INVALID_CODE',
    );
  }

  const latest = await prisma.authCode.findFirst({
    where: {
      userId: user.id,
      purpose: params.purpose,
      consumedAt: null,
      expiresAt: { gt: new Date() },
      attempts: { lt: MAX_CODE_ATTEMPTS },
    },
    orderBy: { createdAt: 'desc' },
  });
  if (!latest) {
    throw new AuthError(
      'Código no válido o caducado',
      400,
      'INVALID_CODE',
    );
  }

  const passwordHash = await hashPassword(params.password);
  const expectedCodeHash = hashAuthCode(
    user.id,
    params.purpose,
    params.code.trim(),
  );

  const accepted = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`
      SELECT pg_advisory_xact_lock(hashtextextended(${latest.id}, 0))
    `;
    const current = await tx.authCode.findUnique({
      where: { id: latest.id },
    });

    if (
      !current ||
      current.consumedAt ||
      current.expiresAt <= new Date() ||
      current.attempts >= MAX_CODE_ATTEMPTS ||
      !safeEqualText(current.codeHash, expectedCodeHash)
    ) {
      if (
        current &&
        !current.consumedAt &&
        current.attempts < MAX_CODE_ATTEMPTS
      ) {
        await tx.authCode.update({
          where: { id: current.id },
          data: { attempts: { increment: 1 } },
        });
      }
      return false;
    }

    const consumedAt = new Date();
    await tx.authCode.updateMany({
      where: { userId: user.id, consumedAt: null },
      data: { consumedAt },
    });
    await tx.user.update({
      where: { id: user.id },
      data: {
        passwordHash,
        passwordSetAt: consumedAt,
        failedLoginAttempts: 0,
        lockedUntil: null,
      },
    });
    await tx.authSession.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: consumedAt },
    });

    return true;
  });

  if (!accepted) {
    throw new AuthError(
      'Código no válido o caducado',
      400,
      'INVALID_CODE',
    );
  }

  return issueSession(user.id);
}

export function requestActivationCode(email: string) {
  return requestCode(email, AuthCodePurpose.ACTIVATE);
}

export function activateAccount(
  email: string,
  code: string,
  password: string,
) {
  return consumeCodeAndSetPassword({
    rawEmail: email,
    code,
    password,
    purpose: AuthCodePurpose.ACTIVATE,
  });
}

export function requestPasswordReset(email: string) {
  return requestCode(email, AuthCodePurpose.RESET_PASSWORD);
}

export function resetPassword(
  email: string,
  code: string,
  password: string,
) {
  return consumeCodeAndSetPassword({
    rawEmail: email,
    code,
    password,
    purpose: AuthCodePurpose.RESET_PASSWORD,
  });
}

export async function login(emailValue: string, password: string) {
  const email = normalizeEmail(emailValue);
  const user = await prisma.user.findFirst({
    where: { email: { equals: email, mode: 'insensitive' } },
  });

  const invalid = () =>
    new AuthError(
      'Correo o contraseña incorrectos',
      401,
      'INVALID_CREDENTIALS',
    );

  if (password.length > 128) throw invalid();
  if (!user?.passwordHash) {
    await hashPassword(password || 'invalid-password');
    throw invalid();
  }
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    throw new AuthError(
      'Demasiados intentos. Espera unos minutos antes de volver a intentarlo.',
      429,
      'LOGIN_TEMPORARILY_LOCKED',
    );
  }

  if (!(await verifyPassword(password, user.passwordHash))) {
    const attempts = user.failedLoginAttempts + 1;
    await prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginAttempts: attempts,
        lockedUntil:
          attempts >= 5
            ? new Date(Date.now() + LOGIN_LOCK_MS)
            : null,
      },
    });
    throw invalid();
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { failedLoginAttempts: 0, lockedUntil: null },
  });
  return issueSession(user.id);
}

export async function refreshSession(refreshToken: string) {
  const tokenHash = hashRefreshToken(refreshToken.trim());
  const session = await prisma.authSession.findUnique({
    where: { refreshTokenHash: tokenHash },
  });

  if (
    !session ||
    session.revokedAt ||
    session.expiresAt <= new Date()
  ) {
    throw new AuthError(
      'La sesión ha caducado',
      401,
      'INVALID_REFRESH_TOKEN',
    );
  }

  const nextRefreshToken = generateRefreshToken(session.id);
  const rotated = await prisma.authSession.updateMany({
    where: {
      id: session.id,
      refreshTokenHash: tokenHash,
      revokedAt: null,
      expiresAt: { gt: new Date() },
    },
    data: {
      refreshTokenHash: hashRefreshToken(nextRefreshToken),
      lastUsedAt: new Date(),
    },
  });
  if (rotated.count !== 1) {
    throw new AuthError(
      'La sesión ha caducado',
      401,
      'INVALID_REFRESH_TOKEN',
    );
  }

  return {
    ok: true,
    accessToken: createAccessToken(session.userId, session.id),
    refreshToken: nextRefreshToken,
    expiresIn: 15 * 60,
  };
}

export async function logout(sessionId: string) {
  await prisma.authSession.updateMany({
    where: { id: sessionId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return { ok: true };
}

export async function changePassword(
  userId: string,
  currentPassword: string,
  nextPassword: string,
) {
  const passwordError = validatePassword(nextPassword);
  if (passwordError) {
    throw new AuthError(passwordError, 400, 'INVALID_PASSWORD');
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
  });
  if (
    !user?.passwordHash ||
    !(await verifyPassword(currentPassword, user.passwordHash))
  ) {
    throw new AuthError(
      'La contraseña actual no es correcta',
      401,
      'INVALID_CURRENT_PASSWORD',
    );
  }

  const passwordHash = await hashPassword(nextPassword);
  await prisma.$transaction([
    prisma.user.update({
      where: { id: user.id },
      data: { passwordHash, passwordSetAt: new Date() },
    }),
    prisma.authSession.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
  ]);

  return issueSession(user.id);
}
