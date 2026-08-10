import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SignJWT } from 'jose';

process.env.AUTH_ACCESS_TOKEN_SECRET =
  'test-access-secret-with-at-least-32-characters';
process.env.AUTH_CODE_SECRET =
  'test-code-secret-with-at-least-32-characters';
process.env.AUTH_ACCESS_TOKEN_ISSUER = 'clubreads-api-test';
process.env.AUTH_ACCESS_TOKEN_AUDIENCE = 'clubreads-app-test';

const {
  createAccessToken,
  hashAuthCode,
  hashPassword,
  normalizeEmail,
  safeEqualText,
  validatePassword,
  verifyAccessToken,
  verifyPassword,
} = await import('../src/services/auth-crypto.service.js');

test('normaliza el correo sin alterar la parte útil', () => {
  assert.equal(
    normalizeEmail('  Usuaria@Example.COM '),
    'usuaria@example.com',
  );
});

test('scrypt valida la contraseña correcta y rechaza otra', async () => {
  const encoded = await hashPassword('contraseña suficientemente larga');
  assert.equal(
    await verifyPassword(
      'contraseña suficientemente larga',
      encoded,
    ),
    true,
  );
  assert.equal(await verifyPassword('otra contraseña', encoded), false);
});

test('la política de contraseña exige al menos 10 caracteres', () => {
  assert.ok(validatePassword('corta'));
  assert.equal(validatePassword('suficientemente larga'), null);
});

test('el código queda ligado a usuaria y propósito', () => {
  const activation = hashAuthCode(
    'user-1',
    'ACTIVATE',
    '123456',
  );
  assert.equal(
    safeEqualText(
      activation,
      hashAuthCode('user-1', 'ACTIVATE', '123456'),
    ),
    true,
  );
  assert.notEqual(
    activation,
    hashAuthCode('user-1', 'RESET_PASSWORD', '123456'),
  );
});

const jwtSecret = new TextEncoder().encode(
  process.env.AUTH_ACCESS_TOKEN_SECRET,
);

function customAccessToken({
  algorithm = 'HS256',
  issuer = 'clubreads-api-test',
  audience = 'clubreads-app-test',
  type = 'access',
  issuedAt = Math.floor(Date.now() / 1000),
  expiresAt = Math.floor(Date.now() / 1000) + 15 * 60,
}: {
  algorithm?: 'HS256' | 'HS384';
  issuer?: string;
  audience?: string;
  type?: string;
  issuedAt?: number;
  expiresAt?: number;
} = {}) {
  return new SignJWT({ sid: 'session-1', type })
    .setProtectedHeader({ alg: algorithm, typ: 'JWT' })
    .setSubject('user-1')
    .setIssuer(issuer)
    .setAudience(audience)
    .setIssuedAt(issuedAt)
    .setExpirationTime(expiresAt)
    .sign(jwtSecret);
}

test('firma y verifica un access token HS256 con claims completos', async () => {
  const token = await createAccessToken('user-1', 'session-1');
  const payload = await verifyAccessToken(token);
  assert.equal(payload?.sub, 'user-1');
  assert.equal(payload?.sid, 'session-1');
  assert.equal(payload?.type, 'access');
  assert.equal(payload?.iss, 'clubreads-api-test');
  assert.equal(payload?.aud, 'clubreads-app-test');
  assert.equal(payload!.exp - payload!.iat, 15 * 60);
});

test('rechaza una firma alterada', async () => {
  const token = await createAccessToken('user-1', 'session-1');
  const [header, payload, signature] = token.split('.');
  const tamperedSignature = `${signature!.slice(0, 5)}${
    signature![5] === 'a' ? 'b' : 'a'
  }${signature!.slice(6)}`;
  assert.equal(
    await verifyAccessToken(`${header}.${payload}.${tamperedSignature}`),
    null,
  );
});

test('rechaza algoritmo, issuer, audience y tipo incorrectos', async () => {
  assert.equal(
    await verifyAccessToken(await customAccessToken({ algorithm: 'HS384' })),
    null,
  );
  assert.equal(
    await verifyAccessToken(await customAccessToken({ issuer: 'otro-api' })),
    null,
  );
  assert.equal(
    await verifyAccessToken(await customAccessToken({ audience: 'otra-app' })),
    null,
  );
  assert.equal(
    await verifyAccessToken(await customAccessToken({ type: 'refresh' })),
    null,
  );
});

test('rechaza tokens expirados o con iat futuro', async () => {
  const now = Math.floor(Date.now() / 1000);
  assert.equal(
    await verifyAccessToken(
      await customAccessToken({ issuedAt: now - 910, expiresAt: now - 10 }),
    ),
    null,
  );
  assert.equal(
    await verifyAccessToken(
      await customAccessToken({ issuedAt: now + 60, expiresAt: now + 900 }),
    ),
    null,
  );
});

test('rechaza tokens enormes o malformados antes de decodificar', async () => {
  assert.equal(await verifyAccessToken('a'.repeat(4097)), null);
  assert.equal(await verifyAccessToken('no-es-un-jwt'), null);
});
