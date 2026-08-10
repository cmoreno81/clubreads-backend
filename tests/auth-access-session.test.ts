import assert from 'node:assert/strict';
import { test } from 'node:test';

process.env.AUTH_ACCESS_TOKEN_SECRET =
  'test-access-secret-with-at-least-32-characters';
process.env.AUTH_CODE_SECRET =
  'test-code-secret-with-at-least-32-characters';
process.env.AUTH_ACCESS_TOKEN_ISSUER = 'clubreads-api-test';
process.env.AUTH_ACCESS_TOKEN_AUDIENCE = 'clubreads-app-test';

const { createAccessToken, generateRefreshToken, hashRefreshToken, verifyAccessToken } =
  await import('../src/services/auth-crypto.service.js');
const { findActiveAccessSession } =
  await import('../src/middleware/auth.middleware.js');
const { refreshSession } = await import('../src/services/auth.service.js');

test('la validación posterior rechaza una sesión revocada', async () => {
  const token = await createAccessToken('user-1', 'session-1');
  const payload = await verifyAccessToken(token);
  assert.ok(payload);

  let receivedWhere: Record<string, unknown> | undefined;
  const session = await findActiveAccessSession(payload, async (where) => {
    receivedWhere = where;
    return null;
  });

  assert.equal(session, null);
  assert.equal(receivedWhere?.id, 'session-1');
  assert.equal(receivedWhere?.userId, 'user-1');
  assert.equal(receivedWhere?.revokedAt, null);
});

test('una sesión anterior obtiene un access token nuevo mediante refresh', async () => {
  const oldRefreshToken = generateRefreshToken('existing-session');
  const oldHash = hashRefreshToken(oldRefreshToken);
  const existingSession = {
    id: 'existing-session',
    userId: 'existing-user',
    revokedAt: null,
    expiresAt: new Date(Date.now() + 60_000),
    lastUsedAt: new Date(Date.now() - 60_000),
  };
  let rotated = false;

  const result = await refreshSession(oldRefreshToken, {
    findByHash: async (tokenHash) =>
      tokenHash === oldHash ? existingSession : null,
    findById: async () => null,
    rotate: async (sessionId, tokenHash, nextTokenHash) => {
      assert.equal(sessionId, existingSession.id);
      assert.equal(tokenHash, oldHash);
      assert.notEqual(nextTokenHash, oldHash);
      rotated = true;
      return 1;
    },
  });

  assert.equal(rotated, true);
  assert.notEqual(result.refreshToken, oldRefreshToken);
  const accessPayload = await verifyAccessToken(result.accessToken);
  assert.equal(accessPayload?.sub, existingSession.userId);
  assert.equal(accessPayload?.sid, existingSession.id);
});
