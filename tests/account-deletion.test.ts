import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { ClubType } from '@prisma/client';

import { clubesQueBloqueanEliminacion } from '../src/services/auth.service.js';

const schema = readFileSync(new URL('../prisma/schema.prisma', import.meta.url), 'utf8');
const migration = readFileSync(
  new URL('../prisma/migrations/20260919150000_add_user_deleted_at/migration.sql', import.meta.url),
  'utf8',
);
const authService = readFileSync(new URL('../src/services/auth.service.ts', import.meta.url), 'utf8');
const controller = readFileSync(new URL('../src/controllers/auth.controller.ts', import.meta.url), 'utf8');
const router = readFileSync(new URL('../src/routes/api.router.ts', import.meta.url), 'utf8');
const validation = readFileSync(new URL('../src/validation/api-validation.ts', import.meta.url), 'utf8');

test('User guarda cuándo se eliminó la cuenta sin borrar la fila', () => {
  const user = schema.match(/model User \{[\s\S]*?\n\}/)?.[0];
  assert.ok(user);
  assert.match(user, /deletedAt\s+DateTime\?/);
  assert.match(migration, /ALTER TABLE "User" ADD COLUMN/);
  assert.doesNotMatch(migration, /DROP TABLE "User"/);
});

test('eliminarCuenta exige la contraseña actual, como cambiarPassword', () => {
  assert.match(authService, /export async function eliminarCuenta/);
  assert.match(
    authService,
    /user\.passwordHash &&\s*\n\s*\(!password \|\| !\(await verifyPassword\(password, user\.passwordHash\)\)\)/,
  );
  assert.match(authService, /'INVALID_PASSWORD'/);
});

test('la ruta está cableada como POST autenticado y validada', () => {
  assert.match(router, /case 'eliminarCuenta':/);
  assert.match(router, /'eliminarCuenta',\n/);
  assert.match(router, /handleDeleteAccount\(req, res\)/);
  assert.match(controller, /req\.auth!\.userId, value\(req, 'password'\)/);
  assert.match(validation, /eliminarCuenta: body\(/);
});

test('anonimiza en vez de borrar la fila, porque comentarios/reseñas/votos no tienen cascade a User', () => {
  assert.match(authService, /name: `Cuenta eliminada \$\{placeholder\}`/);
  assert.match(authService, /email: `\$\{placeholder\}@clubreads\.invalid`/);
  assert.match(authService, /passwordHash: null/);
  assert.match(authService, /deletedAt: new Date\(\)/);
  // No debe intentar un prisma.user.delete: reventaría por FK en Comment/Review/Like/Library/ClubvisionVote.
  assert.doesNotMatch(authService, /prisma\.user\.delete\(/);
});

test('revoca sesiones y borra códigos, igual que logout/changePassword', () => {
  const cuerpo = authService.match(/export async function eliminarCuenta[\s\S]*?\n\}/)?.[0];
  assert.ok(cuerpo);
  assert.match(cuerpo, /authSession\.updateMany\(\{\s*\n\s*where: \{ userId, revokedAt: null \}/);
  assert.match(cuerpo, /authCode\.deleteMany\(\{ where: \{ userId \} \}\)/);
  assert.match(cuerpo, /clubMember\.deleteMany\(\{ where: \{ userId \} \}\)/);
});

test('clubesQueBloqueanEliminacion: solo bloquean clubes sociales con más gente dentro', () => {
  const personal = { id: '1', name: 'Mi espacio lector', tipo: ClubType.PERSONAL, miembros: 1 };
  const clubSolaEnEl = { id: '2', name: 'Club abandonado', tipo: ClubType.SOCIAL, miembros: 1 };
  const clubConGente = { id: '3', name: 'Nuestros gustos son clichés', tipo: ClubType.SOCIAL, miembros: 4 };

  assert.deepEqual(clubesQueBloqueanEliminacion([personal]), []);
  assert.deepEqual(clubesQueBloqueanEliminacion([clubSolaEnEl]), []);
  assert.deepEqual(clubesQueBloqueanEliminacion([clubConGente]), [clubConGente]);
  assert.deepEqual(
    clubesQueBloqueanEliminacion([personal, clubSolaEnEl, clubConGente]),
    [clubConGente],
  );
});

test('eliminarCuenta comprueba que la cuenta existe antes de nada', () => {
  const cuerpo = authService.match(/export async function eliminarCuenta[\s\S]*?\n\}/)?.[0];
  assert.ok(cuerpo);
  assert.match(cuerpo, /if \(!user\) \{/);
  assert.match(cuerpo, /'USER_NOT_FOUND'/);
});
