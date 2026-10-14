import assert from 'node:assert/strict';
import test from 'node:test';

import type { NotificationType } from '@prisma/client';

import { TIPOS_NOTIFICACION } from '../src/services/notifications.service.js';

test('Ajustes → Notificaciones ofrece los avisos de amigos y de metas, y no repite ninguno', () => {
  for (const tipo of [
    'AMISTAD_SOLICITUD', 'AMISTAD_ACEPTADA', 'PROGRESO_COMENTARIO', 'LIBRO_RECOMENDADO',
    'LECTURA_AMISTAD_INVITACION', 'LECTURA_AMISTAD_ACEPTADA', 'LECTURA_AMISTAD_ELIMINADA',
    'LECTURA_META_PROXIMA', 'LECTURA_META_HOY', 'LECTURA_INVITACION',
  ]) {
    assert.ok(TIPOS_NOTIFICACION.includes(tipo as NotificationType), `falta ${tipo}`);
  }
  assert.equal(new Set(TIPOS_NOTIFICACION).size, TIPOS_NOTIFICACION.length);
});
