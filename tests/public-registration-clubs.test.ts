import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

function source(relative: string) {
  return readFileSync(new URL(relative, import.meta.url), 'utf8');
}

const schema = source('../prisma/schema.prisma');
const auth = source('../src/services/auth.service.ts');
const clubs = source('../src/services/clubs.service.ts');
const context = source('../src/services/club-context.service.ts');
const router = source('../src/routes/api.router.ts');
const books = source('../src/services/books.service.ts');
const profile = source('../src/services/perfil.service.ts');
const generalDashboard = source(
  '../src/services/general-dashboard.service.ts',
);
const readings = source('../src/services/readings.service.ts');

test('el registro público verifica el correo antes de emitir sesión', () => {
  assert.match(schema, /enum AuthCodePurpose \{[\s\S]*REGISTER/);
  assert.match(auth, /requestRegistrationCode/);
  assert.match(auth, /purpose: AuthCodePurpose\.REGISTER/);
  assert.match(router, /case 'solicitarRegistro'/);
  assert.match(router, /case 'completarRegistro'/);
});

test('una cuenta nueva no cae automáticamente en el club fundador', () => {
  assert.match(context, /NO_ACTIVE_CLUB/);
  assert.doesNotMatch(
    context,
    /const club = user\.activeClub \?\? \(await getDefaultClub\(\)\)/,
  );
});

test('crear y unirse a un club establece una membresía y club activo', () => {
  assert.match(clubs, /role: ClubRole\.OWNER/);
  assert.match(clubs, /role: ClubRole\.MEMBER/);
  assert.match(clubs, /activeClubId: created\.id/);
  assert.match(clubs, /activeClubId: club\.id/);
});

test('las bibliotecas se limitan a integrantes del club activo', () => {
  const filters = books.match(
    /user: \{ clubMemberships: \{ some: \{ clubId: club\.id \} \} \}/g,
  );
  assert.ok(filters && filters.length >= 2);
});

test('los perfiles solo se resuelven dentro del club activo', () => {
  assert.match(profile, /getCurrentClubContext\(solicitante\)/);
  assert.match(
    profile,
    /clubMemberships: \{ some: \{ clubId: club\.id \} \}/,
  );
});

test('el dashboard general funciona sin exigir un club activo', () => {
  assert.match(generalDashboard, /where: \{ id: userId \}/);
  assert.match(generalDashboard, /rachaMeses/);
  assert.match(generalDashboard, /calendario/);
  assert.match(generalDashboard, /tendencias/);
  assert.match(generalDashboard, /communityFormats/);
  assert.match(generalDashboard, /prisma\.library\.groupBy/);
  assert.match(generalDashboard, /readingFormat: \{ not: null \}/);
  assert.doesNotMatch(generalDashboard, /getCurrentClubContext/);
  assert.match(profile, /seriesPersonales/);
  assert.match(profile, /sagasAbiertas/);
  assert.match(
    profile,
    /estado !== 'PENDIENTE' && estado !== 'COMPLETADA'/,
  );
  assert.match(profile, /siguiente: reading \?\? next/);
});

test('la comunidad cuenta cuentas nuevas y lectoras históricas con club', () => {
  assert.match(generalDashboard, /passwordHash: \{ not: null \}/);
  assert.match(generalDashboard, /clubMemberships: \{ some: \{\} \}/);
});

test('cualquier integrante puede configurar la lectura oficial del club', () => {
  assert.match(
    readings,
    /const \{ club \} = legacyRequest[\s\S]*: await requireClubMember\(data\.usuario\)/,
  );
  assert.doesNotMatch(
    readings,
    /requestedType === ReadingType\.CLUBVISION[\s\S]*requireClubRole/,
  );
});

test('la biblioteca identifica a la persona autenticada sin usar usuario', () => {
  assert.match(books, /const \{ club, user \} = await getCurrentClubContext/);
  assert.match(books, /yaLoTengo: item\.userId === user\?\.id/);
});
