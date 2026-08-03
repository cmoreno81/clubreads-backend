import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const notifications = await readFile(
  new URL('../src/services/notifications.service.ts', import.meta.url),
  'utf8',
);

test('eventos de libro incluyen bookId y título estructurado', () => {
  for (const name of ['notifyLibroTerminado', 'notifyLibroEmpezado']) {
    const start = notifications.indexOf(`export async function ${name}`);
    const end = notifications.indexOf('\nexport async function', start + 1);
    const source = notifications.slice(start, end < 0 ? undefined : end);
    assert.match(source, /bookId,/);
    assert.match(source, /extra: \{ bookTitle \}/);
  }
});

test('lecturas y comentarios incluyen referencias de navegación disponibles', () => {
  assert.match(notifications, /notifyLecturaNueva[\s\S]*extra: \{ bookTitle, \.\.\.\(readingId/);
  assert.match(notifications, /notifyLecturaCompartida[\s\S]*extra: \{ bookTitle, \.\.\.\(readingId/);
  assert.match(notifications, /notifyComentarioLectura[\s\S]*JSON\.stringify\(\{[\s\S]*bookTitle,[\s\S]*readingId/);
});

test('Clubvisión y nueva miembro incluyen sus referencias', () => {
  assert.match(notifications, /notifyClubvisionAbierta[\s\S]*notifyClubMembers\(\{[\s\S]*clubId,/);
  assert.match(notifications, /notifyClubvisionResultados[\s\S]*notifyClubMembers\(\{[\s\S]*clubId,/);
  assert.match(notifications, /notifyNuevaMiembro[\s\S]*extra: \{ userId: nuevaMiembroUserId \}/);
});

test('alta individual incluye bookId y la agrupada un destino explícito', () => {
  assert.match(notifications, /bookId: libros\.length === 1 \? libros\[0\]\?\.id : undefined/);
  assert.match(notifications, /destination: 'BIBLIOTECA'/);
  assert.match(notifications, /bookIds: libros\.map/);
});
