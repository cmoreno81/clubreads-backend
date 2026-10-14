import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('el aviso de solicitud dice «te ha enviado una solicitud de amistad»', () => {
  const src = readFileSync('src/services/notifications.service.ts', 'utf8');
  assert.match(src, /\$\{deNombre\} te ha enviado una solicitud de amistad/);
  assert.doesNotMatch(src, /quiere ser tu (amistad|amigo)/);
});
