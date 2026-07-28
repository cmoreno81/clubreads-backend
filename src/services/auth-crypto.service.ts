import {
  createHash,
  createHmac,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);
const PASSWORD_KEY_LENGTH = 64;

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

function encodeJson(value: unknown) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function decodeJson<T>(value: string): T {
  return JSON.parse(
    Buffer.from(value, 'base64url').toString('utf8'),
  ) as T;
}

export type AccessTokenPayload = {
  sub: string;
  sid: string;
  type: 'access';
  iat: number;
  exp: number;
};

export function createAccessToken(userId: string, sessionId: string) {
  const now = Math.floor(Date.now() / 1000);
  const header = encodeJson({ alg: 'HS256', typ: 'JWT' });
  const payload = encodeJson({
    sub: userId,
    sid: sessionId,
    type: 'access',
    iat: now,
    exp: now + 15 * 60,
  } satisfies AccessTokenPayload);
  const content = `${header}.${payload}`;
  const signature = createHmac(
    'sha256',
    requiredSecret('AUTH_ACCESS_TOKEN_SECRET'),
  )
    .update(content)
    .digest('base64url');

  return `${content}.${signature}`;
}

export function verifyAccessToken(token: string) {
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [header, payload, signature] = parts;
  if (!header || !payload || !signature) return null;

  const expected = createHmac(
    'sha256',
    requiredSecret('AUTH_ACCESS_TOKEN_SECRET'),
  )
    .update(`${header}.${payload}`)
    .digest();
  if (signature !== expected.toString('base64url')) {
    return null;
  }
  const actual = Buffer.from(signature, 'base64url');

  if (
    actual.length !== expected.length ||
    !timingSafeEqual(actual, expected)
  ) {
    return null;
  }

  try {
    const parsed = decodeJson<AccessTokenPayload>(payload);
    const headerData = decodeJson<{ alg?: string }>(header);
    const now = Math.floor(Date.now() / 1000);

    if (
      headerData.alg !== 'HS256' ||
      parsed.type !== 'access' ||
      !parsed.sub ||
      !parsed.sid ||
      !Number.isInteger(parsed.exp) ||
      parsed.exp <= now
    ) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

export function generateRefreshToken(sessionId: string) {
  return `${sessionId}.${randomBytes(32).toString('base64url')}`;
}
