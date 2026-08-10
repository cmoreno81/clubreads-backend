import {
  createHash,
  createHmac,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from 'node:crypto';
import { promisify } from 'node:util';
import { jwtVerify, SignJWT } from 'jose';

const scrypt = promisify(scryptCallback);
const PASSWORD_KEY_LENGTH = 64;
const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
const ACCESS_TOKEN_MAX_BYTES = 4096;
const ACCESS_TOKEN_CLOCK_TOLERANCE_SECONDS = 5;

function requiredSecret(name: string) {
  const value = process.env[name]?.trim();
  if (!value || value.length < 32) {
    throw new Error(`${name} debe tener al menos 32 caracteres`);
  }
  return value;
}

export function normalizeEmail(email: string) {
  return email.trim().toLocaleLowerCase('en-US');
}

export function validatePassword(password: string) {
  if (password.length < 10) {
    return 'La contraseña debe tener al menos 10 caracteres';
  }
  if (password.length > 128) {
    return 'La contraseña no puede superar 128 caracteres';
  }
  return null;
}

export async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const derived = (await scrypt(
    password,
    salt,
    PASSWORD_KEY_LENGTH,
  )) as Buffer;

  return `scrypt$${salt.toString('base64url')}$${derived.toString('base64url')}`;
}

export async function verifyPassword(password: string, encoded: string) {
  const [algorithm, saltText, hashText] = encoded.split('$');
  if (algorithm !== 'scrypt' || !saltText || !hashText) return false;

  const salt = Buffer.from(saltText, 'base64url');
  const expected = Buffer.from(hashText, 'base64url');
  const actual = (await scrypt(
    password,
    salt,
    expected.length,
  )) as Buffer;

  return (
    actual.length === expected.length &&
    timingSafeEqual(actual, expected)
  );
}

export function hashAuthCode(
  userId: string,
  purpose: string,
  code: string,
) {
  return createHmac(
    'sha256',
    requiredSecret('AUTH_CODE_SECRET'),
  )
    .update(`${userId}:${purpose}:${code}`)
    .digest('base64url');
}

export function hashRefreshToken(token: string) {
  return createHash('sha256').update(token).digest('base64url');
}

export function safeEqualText(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

export type AccessTokenPayload = {
  sub: string;
  sid: string;
  type: 'access';
  iat: number;
  exp: number;
  iss: string;
  aud: string | string[];
};

function accessTokenConfig() {
  return {
    secret: new TextEncoder().encode(
      requiredSecret('AUTH_ACCESS_TOKEN_SECRET'),
    ),
    issuer: process.env.AUTH_ACCESS_TOKEN_ISSUER?.trim() || 'clubreads-api',
    audience:
      process.env.AUTH_ACCESS_TOKEN_AUDIENCE?.trim() || 'clubreads-app',
  };
}

export async function createAccessToken(userId: string, sessionId: string) {
  const { secret, issuer, audience } = accessTokenConfig();
  return new SignJWT({ sid: sessionId, type: 'access' })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(userId)
    .setIssuer(issuer)
    .setAudience(audience)
    .setIssuedAt()
    .setExpirationTime(`${ACCESS_TOKEN_TTL_SECONDS}s`)
    .sign(secret);
}

export async function verifyAccessToken(token: string) {
  if (
    typeof token !== 'string' ||
    token.length === 0 ||
    Buffer.byteLength(token, 'utf8') > ACCESS_TOKEN_MAX_BYTES
  ) {
    return null;
  }

  try {
    const { secret, issuer, audience } = accessTokenConfig();
    const { payload, protectedHeader } = await jwtVerify(token, secret, {
      algorithms: ['HS256'],
      issuer,
      audience,
      maxTokenAge: `${ACCESS_TOKEN_TTL_SECONDS}s`,
      clockTolerance: ACCESS_TOKEN_CLOCK_TOLERANCE_SECONDS,
    });
    const now = Math.floor(Date.now() / 1000);

    if (
      protectedHeader.alg !== 'HS256' ||
      protectedHeader.typ !== 'JWT' ||
      payload.type !== 'access' ||
      typeof payload.sub !== 'string' ||
      payload.sub.length === 0 ||
      typeof payload.sid !== 'string' ||
      payload.sid.length === 0 ||
      !Number.isInteger(payload.iat) ||
      !Number.isInteger(payload.exp) ||
      payload.iat! > now + ACCESS_TOKEN_CLOCK_TOLERANCE_SECONDS ||
      payload.exp! <= payload.iat! ||
      payload.exp! - payload.iat! > ACCESS_TOKEN_TTL_SECONDS
    ) {
      return null;
    }

    return payload as AccessTokenPayload;
  } catch {
    return null;
  }
}

export function generateRefreshToken(sessionId: string) {
  return `${sessionId}.${randomBytes(32).toString('base64url')}`;
}
