import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const schema = readFileSync(
  new URL('../prisma/schema.prisma', import.meta.url),
  'utf8',
);
const migration = readFileSync(
  new URL(
    '../prisma/migrations/20260728190000_add_email_password_auth/migration.sql',
    import.meta.url,
  ),
  'utf8',
);
const readingsService = readFileSync(
  new URL('../src/services/readings.service.ts', import.meta.url),
  'utf8',
);
const router = readFileSync(
  new URL('../src/routes/api.router.ts', import.meta.url),
  'utf8',
);
const authMiddleware = readFileSync(
  new URL('../src/middleware/auth.middleware.ts', import.meta.url),
  'utf8',
);

test('las credenciales se añaden a User sin sustituir la cuenta', () => {
  const user = schema.match(/model User \{[\s\S]*?\n\}/)?.[0];
  assert.ok(user);
  assert.match(user, /passwordHash\s+String\?/);
  assert.match(user, /passwordSetAt\s+DateTime\?/);
  assert.match(migration, /ALTER TABLE "User"/);
  assert.doesNotMatch(migration, /DROP TABLE "User"/);
});

test('códigos y sesiones caducan y se pueden revocar', () => {
  const code = schema.match(/model AuthCode \{[\s\S]*?\n\}/)?.[0];
  const session = schema.match(
    /model AuthSession \{[\s\S]*?\n\}/,
  )?.[0];

  assert.ok(code);
  assert.ok(session);
  assert.match(code, /expiresAt\s+DateTime/);
  assert.match(code, /consumedAt\s+DateTime\?/);
  assert.match(session, /refreshTokenHash\s+String\s+@unique/);
  assert.match(session, /revokedAt\s+DateTime\?/);
});

test('la migración normaliza correos y aborta ante duplicados', () => {
  assert.match(
    migration,
    /GROUP BY lower\(btrim\("email"\)\)/,
  );
  assert.match(
    migration,
    /UPDATE "User" SET "email" = lower\(btrim\("email"\)\)/,
  );
});

test('toda la API privada exige token y no acepta identidad legada', () => {
  assert.match(router, /!PUBLIC_AUTH_ACTIONS\.has\(action\) && !req\.auth/);
  assert.doesNotMatch(router, /AUTH_REQUIRE_ACCESS_TOKEN/);
  assert.match(
    router,
    /apiRouter\.get\('\/achievements', requireAuthentication/,
  );
  assert.match(
    router,
    /'\/series\/order',[\s\S]*requireAuthentication/,
  );
  assert.doesNotMatch(readingsService, /legacyApkEnabled|legacyRequest/);
  assert.doesNotMatch(authMiddleware, /String\(legacyValue/);
});
