import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const [service, schema, migration, router] = await Promise.all([
  readFile(new URL('../src/services/clubvision.service.ts', import.meta.url), 'utf8'),
  readFile(new URL('../prisma/schema.prisma', import.meta.url), 'utf8'),
  readFile(new URL('../prisma/migrations/20260901130000_add_welcome_clubvision/migration.sql', import.meta.url), 'utf8'),
  readFile(new URL('../src/routes/api.router.ts', import.meta.url), 'utf8'),
]);

test('la bienvenida tiene plazos propios, requisitos y una sola edición por club', () => {
  assert.match(service, /WELCOME_VOTING_HOURS = 48/);
  assert.match(service, /WELCOME_RESULTS_HOURS = 24/);
  assert.match(service, /WELCOME_MIN_MEMBERS = 3/);
  assert.match(service, /WELCOME_MIN_CANDIDATES = 5/);
  assert.match(service, /WELCOME_MIN_INTERESTED = 2/);
  assert.match(service, /fitsBeforeNextClubvisionEdition/);
  assert.match(service, /getClubvisionCalendar\(\)\.day <= 3/);
  assert.match(schema, /kind ClubvisionKind @default\(MONTHLY\)/);
  assert.match(schema, /votingEndsAt DateTime\?/);
  assert.match(migration, /Clubvision_one_welcome_per_club/);
});

test('solo administradoras pueden iniciar la bienvenida mediante POST', () => {
  assert.match(service, /requireClubRole\(usuario, \[ClubRole\.OWNER, ClubRole\.ADMIN\]\)/);
  assert.match(router, /'iniciarClubvisionBienvenida'/);
  assert.match(router, /case 'iniciarClubvisionBienvenida':[\s\S]*handleStartWelcomeClubvision/);
});
