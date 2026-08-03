import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { deleteNotificationForUser } from '../src/services/notifications.service.js';

function fakeNotifications() {
  const rows = [
    { id: 'own', userId: 'user-a' },
    { id: 'foreign', userId: 'user-b' },
  ];
  return {
    rows,
    client: {
      notification: {
        deleteMany: async ({ where }: { where: { id: string; userId: string } }) => {
          const index = rows.findIndex(
            ({ id, userId }) => id === where.id && userId === where.userId,
          );
          if (index < 0) return { count: 0 };
          rows.splice(index, 1);
          return { count: 1 };
        },
      },
    },
  };
}

test('elimina una notificación propia', async () => {
  const { rows, client } = fakeNotifications();
  assert.deepEqual(await deleteNotificationForUser(client, 'user-a', 'own'), { ok: true });
  assert.deepEqual(rows, [{ id: 'foreign', userId: 'user-b' }]);
});

test('no permite borrar una notificación ajena', async () => {
  const { rows, client } = fakeNotifications();
  const before = structuredClone(rows);
  assert.deepEqual(await deleteNotificationForUser(client, 'user-a', 'foreign'), { ok: true });
  assert.deepEqual(rows, before);
});

test('un segundo borrado del mismo ID es idempotente', async () => {
  const { rows, client } = fakeNotifications();
  assert.deepEqual(await deleteNotificationForUser(client, 'user-a', 'own'), { ok: true });
  assert.deepEqual(await deleteNotificationForUser(client, 'user-a', 'own'), { ok: true });
  assert.deepEqual(rows, [{ id: 'foreign', userId: 'user-b' }]);
});

test('el router exige POST autenticado y toma userId de la sesión', async () => {
  const [router, controller, service] = await Promise.all([
    readFile(new URL('../src/routes/api.router.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/controllers/notifications.controller.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/services/notifications.service.ts', import.meta.url), 'utf8'),
  ]);
  assert.match(router, /POST_ONLY_ACTIONS[\s\S]*'eliminarNotificacion'/);
  assert.match(router, /case 'eliminarNotificacion':[\s\S]*!req\.auth[\s\S]*handleEliminarNotificacion/);
  assert.match(controller, /eliminarNotificacion\(req\.auth!\.userId, id\)/);
  assert.match(service, /deleteMany\(\{\s*where: \{ id: notificacionId, userId \}/);
});
