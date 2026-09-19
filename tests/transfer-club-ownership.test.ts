import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const clubsService = readFileSync(new URL('../src/services/clubs.service.ts', import.meta.url), 'utf8');
const controller = readFileSync(new URL('../src/controllers/clubs.controller.ts', import.meta.url), 'utf8');
const router = readFileSync(new URL('../src/routes/api.router.ts', import.meta.url), 'utf8');
const validation = readFileSync(new URL('../src/validation/api-validation.ts', import.meta.url), 'utf8');
const authService = readFileSync(new URL('../src/services/auth.service.ts', import.meta.url), 'utf8');

test('solo la propietaria puede transferir, y no el espacio personal', () => {
  const cuerpo = clubsService.match(/export async function transferirPropiedad[\s\S]*?\n\}/)?.[0];
  assert.ok(cuerpo);
  assert.match(cuerpo, /membership\.role !== ClubRole\.OWNER/);
  assert.match(cuerpo, /'INSUFFICIENT_CLUB_ROLE'/);
  assert.match(cuerpo, /ClubType\.PERSONAL/);
  assert.match(cuerpo, /'CANNOT_TRANSFER_PERSONAL_SPACE'/);
});

test('la nueva propietaria debe ser ya miembro del club', () => {
  const cuerpo = clubsService.match(/export async function transferirPropiedad[\s\S]*?\n\}/)?.[0];
  assert.ok(cuerpo);
  assert.match(cuerpo, /nuevoOwnerMembership/);
  assert.match(cuerpo, /'NOT_CLUB_MEMBER'/);
});

test('la transferencia mueve ownerId y degrada a la propietaria anterior a ADMIN (no la expulsa)', () => {
  const cuerpo = clubsService.match(/export async function transferirPropiedad[\s\S]*?\n\}/)?.[0];
  assert.ok(cuerpo);
  assert.match(cuerpo, /club\.update\(\{ where: \{ id: clubId \}, data: \{ ownerId: nuevoOwnerId \} \}\)/);
  assert.match(cuerpo, /data: \{ role: ClubRole\.OWNER \}/);
  assert.match(cuerpo, /data: \{ role: ClubRole\.ADMIN \}/);
});

test('la ruta está cableada como POST autenticado y validada', () => {
  assert.match(router, /case 'transferirPropiedadClub':/);
  assert.match(router, /'transferirPropiedadClub',/);
  assert.match(router, /handleTransferOwnership\(req, res\)/);
  assert.match(controller, /req\.auth!\.userId,\s*\n\s*String\(req\.body\?\.clubId \?\? ''\),\s*\n\s*String\(req\.body\?\.nuevoOwnerId \?\? ''\)/);
  assert.match(validation, /transferirPropiedadClub: body\(\{ clubId: identifierSchema, nuevoOwnerId: identifierSchema \}\)/);
});

test('eliminarCuenta ya no necesita cambios: tras transferir, el club deja de aparecer en ownedClubs', () => {
  // La consulta de eliminarCuenta filtra por ownerId, así que en cuanto
  // transferirPropiedad cambia el ownerId, ese club deja de bloquear el borrado.
  assert.match(authService, /where: \{ ownerId: userId \}/);
});
