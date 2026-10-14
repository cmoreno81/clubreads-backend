import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('la denuncia lleva el tipo y el ID del contenido, para poder retirarlo', () => {
  const src = readFileSync('src/services/moderation.service.ts', 'utf8');
  assert.match(src, /`Tipo: \$\{targetType\} · ID: \$\{targetId\}`/);
});

test('el script de moderación no cambia nada sin --ejecutar y hace borrado suave', () => {
  const src = readFileSync('scripts/moderar-contenido.ts', 'utf8');
  assert.match(src, /process\.argv\.includes\('--ejecutar'\)/);
  assert.match(src, /if \(!ejecutar\) console\.log/);
  assert.match(src, /deletedAt: ahora/);
  assert.doesNotMatch(src, /\.delete\(/); // nunca borra de verdad
});
