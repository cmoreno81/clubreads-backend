import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { madridCalendar, madridMonthBounds, resolveDuelWinner } from '../src/services/book-of-year.service.js';

const [schema, migration, service, controller, router, validation] = await Promise.all([
  readFile(new URL('../prisma/schema.prisma', import.meta.url), 'utf8'),
  readFile(new URL('../prisma/migrations/20260815_add_book_of_year/migration.sql', import.meta.url), 'utf8'),
  readFile(new URL('../src/services/book-of-year.service.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/controllers/book-of-year.controller.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/routes/api.router.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/validation/api-validation.ts', import.meta.url), 'utf8'),
]);

test('persistencia queda aislada por usuaria, año, fase y posición', () => {
  for (const model of ['BookOfYearMonthlySelection', 'BookOfYearDuelWinner', 'BookOfYearFinalist', 'BookOfYearWinner']) assert.match(schema, new RegExp(`model ${model}`));
  assert.match(schema, /@@unique\(\[userId, year, month\]\)/);
  assert.match(schema, /@@unique\(\[userId, year, phase, position\]\)/);
  assert.match(schema, /@@unique\(\[userId, year, position\]\)/);
  assert.match(schema, /model BookOfYearWinner[\s\S]*@@unique\(\[userId, year\]\)/);
  assert.match(migration, /CHECK \("month" BETWEEN 1 AND 12\)/);
});

test('solo usa finalizaciones del mes y admite relecturas sin duplicar libros', () => {
  assert.match(service, /readingCompletion\.findMany\([\s\S]*finishedAt: \{ gte: start, lt: end \}/);
  assert.doesNotMatch(service, /isReread: false/);
  assert.match(service, /books\.set\(completion\.bookId/);
});

test('meses futuros se bloquean con calendario Europe\/Madrid', () => {
  assert.deepEqual(madridCalendar(new Date('2026-10-31T23:30:00.000Z')), { year: 2026, month: 11, day: 1 });
  const march = madridMonthBounds(2026, 3);
  assert.equal(march.start.toISOString(), '2026-02-28T23:00:00.000Z');
  assert.equal(march.end.toISOString(), '2026-03-31T22:00:00.000Z');
  assert.match(service, /MONTH_LOCKED/);
});

test('ningún duelo avanza automáticamente y conserva decisiones manuales compatibles', () => {
  assert.deepEqual(resolveDuelWinner(undefined, ['a', undefined]), { bookId: undefined, automatic: false });
  assert.deepEqual(resolveDuelWinner('a', ['a', 'b']), { bookId: 'a', automatic: false });
  assert.deepEqual(resolveDuelWinner('a', ['c', 'b']), { bookId: undefined, automatic: false });
  assert.deepEqual(resolveDuelWinner('winner-other-branch', ['winner-other-branch', 'x']), { bookId: 'winner-other-branch', automatic: false });
  assert.match(service, /bookOfYearWinner\.delete/);
});

test('ignora elecciones automáticas antiguas y solo choose guarda ganadoras', () => {
  assert.match(service, /bookOfYearDuelWinner\.deleteMany\(\{\s*where: \{ userId, year, automatic: true \}/);
  assert.match(service, /findMany\(\{ where: \{ userId, year, automatic: false \}/);
  const syncBracket = service.slice(service.indexOf('async function syncBracket'), service.indexOf('async function boardForUser'));
  assert.doesNotMatch(syncBracket, /bookOfYearDuelWinner\.upsert/);
  assert.match(service, /chooseBookOfYearDuel[\s\S]*bookOfYearDuelWinner\.upsert/);
});

test('una ronda posterior exige las dos ganadoras manuales anteriores', () => {
  assert.match(service, /unlocked: Boolean\(firstWinner\(position \* 2 - 1\) && firstWinner\(position \* 2\)\)/);
});

test('la ganadora anual permanece vacía sin finalistas manuales válidas', () => {
  assert.match(service, /winner: winner && validFinalistIds\.has\(winner\.bookId\) \? serializeBook\(winner\.book\) : null/);
});

test('la final exige diciembre terminado y permite elegir entre tres finalistas', () => {
  assert.match(service, /monthFinished\(year, 12, now\)/);
  assert.match(service, /bookOfYearFinalist\.findFirst\(\{ where: \{ userId, year, bookId \} \}\)/);
  assert.match(service, /position <= 3|position = 1; position <= 3/);
});

test('acciones autenticadas usan la sesión y el acceso público exige club social compartido', () => {
  assert.doesNotMatch(controller, /body\.userId|query\.userId/);
  assert.match(controller, /req\.auth!\.userId/);
  assert.match(service, /assertSharedVisibleClub/);
  assert.match(service, /club: \{ tipo: 'SOCIAL', members: \{ some: \{ userId: targetId \} \} \}/);
  for (const action of ['guardarSeleccionLibroDelAnio', 'elegirDueloLibroDelAnio', 'elegirLibroDelAnio']) assert.match(router, new RegExp(`'${action}'`));
  assert.match(validation, /elegirDueloLibroDelAnio/);
});
