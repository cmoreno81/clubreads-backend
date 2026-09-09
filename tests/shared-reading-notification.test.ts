import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const readings = readFileSync('src/services/readings.service.ts', 'utf8');
const notifications = readFileSync(
  'src/services/notifications.service.ts',
  'utf8',
);

test('crear una lectura compartida avisa al club salvo a quien la crea', () => {
  assert.match(readings, /notifyLecturaCompartida/);
  assert.match(
    readings,
    /void notifyLecturaCompartida\([\s\S]*creadoraUserId: user\.id/,
  );
  assert.match(
    notifications,
    /notifyLecturaCompartida[\s\S]*excludeUserId: creadoraUserId/,
  );
  assert.match(notifications, /titulo: abiertaEnSolitario/);
  assert.match(notifications, /'📖 Nueva lectura compartida'/);
  assert.match(notifications, /'💬 Conversación abierta'/);
  assert.match(notifications, /tipo: NotificationType\.LECTURA_NUEVA/);
});

test('el aviso distingue si la lectura se abre en solitario o ya hay 2+ lectoras', () => {
  assert.match(readings, /lectorasActivas/);
  assert.match(readings, /abiertaEnSolitario: lectorasActivas < 2/);
});
