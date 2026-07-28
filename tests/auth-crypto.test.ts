import assert from 'node:assert/strict';
import { test } from 'node:test';

process.env.AUTH_ACCESS_TOKEN_SECRET =
  'test-access-secret-with-at-least-32-characters';
process.env.AUTH_CODE_SECRET =
  'test-code-secret-with-at-least-32-characters';

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

test('firma y verifica el access token y rechaza manipulaciones', () => {
  const token = createAccessToken('user-1', 'session-1');
  assert.deepEqual(verifyAccessToken(token)?.sub, 'user-1');

  const tampered = `${token.slice(0, -1)}${token.endsWith('a') ? 'b' : 'a'}`;
  assert.equal(verifyAccessToken(tampered), null);
});
