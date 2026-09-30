import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const controller = await readFile(
  new URL('../src/controllers/perfil.controller.ts', import.meta.url),
  'utf8',
);

test('handleActualizarPrivacidadPerfil acepta PUBLICO además de CLUB y PRIVADO', () => {
  const start = controller.indexOf('export async function handleActualizarPrivacidadPerfil(');
  assert.ok(start >= 0, 'no se encontró handleActualizarPrivacidadPerfil');
  const end = controller.indexOf('\n}', start);
  const cuerpo = controller.slice(start, end);

  assert.match(cuerpo, /visibilidad !== ProfileVisibility\.CLUB/);
  assert.match(cuerpo, /visibilidad !== ProfileVisibility\.PRIVADO/);
  assert.match(cuerpo, /visibilidad !== ProfileVisibility\.PUBLICO/);
});
