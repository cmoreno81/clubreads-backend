import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

function source(relative: string) {
  return readFileSync(new URL(relative, import.meta.url), 'utf8');
}

const router = source('../src/routes/api.router.ts');
const usersService = source('../src/services/users.service.ts');

test('usuarios sin token recibe 401', () => {
  const publicActions = router.match(
    /const PUBLIC_AUTH_ACTIONS = new Set\(\[([\s\S]*?)\]\);/,
  )?.[1];

  assert.ok(publicActions);
  assert.doesNotMatch(publicActions, /['"]usuarios['"]/);
  assert.match(
    router,
    /!PUBLIC_AUTH_ACTIONS\.has\(action\) && !req\.auth[\s\S]*?res\.status\(401\)/,
  );
  assert.match(router, /case 'usuarios':\s*return handleUsuarios\(req, res\)/);
});

test('usuarios consulta solo integrantes del club activo y conserva el orden', () => {
  assert.match(usersService, /getCurrentClubContext\(usuario\)/);
  assert.match(
    usersService,
    /prisma\.clubMember\.findMany\(\{[\s\S]*?where: \{ clubId: club\.id \}/,
  );
  assert.match(
    usersService,
    /orderBy: \{\s*user: \{ name: 'asc' \},\s*\}/,
  );
});

test('usuarios selecciona y devuelve únicamente el nombre público', () => {
  assert.match(
    usersService,
    /select: \{\s*user: \{\s*select: \{\s*name: true,?\s*\},\s*\},\s*\}/,
  );
  assert.match(
    usersService,
    /return memberships\.map\(\(\{ user \}\) => \(\{\s*nombre: user\.name,?\s*\}\)\);/,
  );
  assert.doesNotMatch(usersService, /include:\s*\{\s*user:\s*true\s*\}/);
  assert.doesNotMatch(usersService, /\bemail\b|\bpasswordHash\b/);
});
