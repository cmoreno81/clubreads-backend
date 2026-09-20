import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const moderation = readFileSync(new URL('../src/services/moderation.service.ts', import.meta.url), 'utf8');
const feedback = readFileSync(new URL('../src/services/feedback.service.ts', import.meta.url), 'utf8');
const readings = readFileSync(new URL('../src/services/readings.service.ts', import.meta.url), 'utf8');
const controller = readFileSync(new URL('../src/controllers/moderation.controller.ts', import.meta.url), 'utf8');
const router = readFileSync(new URL('../src/routes/api.router.ts', import.meta.url), 'utf8');
const schema = readFileSync(new URL('../prisma/schema.prisma', import.meta.url), 'utf8');

test('UserBlock es unidireccional y en cascada (si se borra una cuenta, sus bloqueos desaparecen)', () => {
  const model = schema.match(/model UserBlock \{[\s\S]*?\n\}/)?.[0];
  assert.ok(model);
  assert.match(model, /blockerId String/);
  assert.match(model, /blockedId String/);
  assert.match(model, /onDelete: Cascade/);
  assert.match(model, /@@unique\(\[blockerId, blockedId\]\)/);
});

test('bloquearUsuario no permite autobloquearse ni bloquear a alguien inexistente', () => {
  const cuerpo = moderation.match(/export async function bloquearUsuario[\s\S]*?\n\}/)?.[0];
  assert.ok(cuerpo);
  assert.match(cuerpo, /'USER_NOT_FOUND'/);
  assert.match(cuerpo, /blocked\.id === blockerId/);
  assert.match(cuerpo, /'CANNOT_BLOCK_SELF'/);
});

test('bloquear es idempotente (upsert, no revienta si ya estaba bloqueada)', () => {
  const cuerpo = moderation.match(/export async function bloquearUsuario[\s\S]*?\n\}/)?.[0];
  assert.ok(cuerpo);
  assert.match(cuerpo, /userBlock\.upsert/);
});

test('idsBloqueadosPor se usa para filtrar comentarios y respuestas en ambos listados', () => {
  assert.match(readings, /import \{ idsBloqueadosPor \} from '\.\/moderation\.service\.js';/);
  // getComentariosLectura (no paginado)
  const simple = readings.match(/export async function getComentariosLectura\([\s\S]*?\n\}/)?.[0];
  assert.ok(simple);
  assert.match(simple, /bloqueadas\.length \? \{ notIn: bloqueadas \} : undefined/);
  // getComentariosLecturaPage (paginado, el que usa la app)
  const paginado = readings.match(/export async function getComentariosLecturaPage\([\s\S]*?\n\nexport/)?.[0];
  assert.ok(paginado);
  const notInCount = (paginado.match(/notIn: bloqueadas/g) ?? []).length;
  assert.ok(notInCount >= 2, 'debe filtrar tanto comentarios de primer nivel como respuestas');
});

test('reportarContenido reutiliza el mismo cauce que enviarFeedback (Jira + email), no un sistema nuevo', () => {
  assert.match(moderation, /import \{ enviarFeedback \} from '\.\/feedback\.service\.js';/);
  const cuerpo = moderation.match(/export async function reportarContenido[\s\S]*?\n\}/)?.[0];
  assert.ok(cuerpo);
  assert.match(cuerpo, /category: 'reporte'/);
  assert.match(cuerpo, /'CONTENT_NOT_FOUND'/);
  assert.match(feedback, /reporte: /); // está en los tres Record<FeedbackCategory,...>
});

test('las rutas de moderación están cableadas y protegidas por autenticación', () => {
  for (const action of ['bloquearUsuario', 'desbloquearUsuario', 'usuariosBloqueados', 'reportarContenido']) {
    const re = new RegExp(`case '${action}':\\s*\\n\\s*if \\(!req\\.auth\\)`);
    assert.match(router, re, `${action} debe exigir sesión`);
  }
  assert.match(router, /'bloquearUsuario',/);
  assert.match(router, /'desbloquearUsuario',/);
  assert.match(router, /'reportarContenido',/);
  assert.match(controller, /handleBloquearUsuario/);
  assert.match(controller, /handleReportarContenido/);
});
