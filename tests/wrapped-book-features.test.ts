import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { getWrappedBookOfYearStatus } from '../src/services/checkin.service.js';

test('el estado del cuadro distingue vacío, progreso, finalistas y ganador', () => {
  assert.equal(getWrappedBookOfYearStatus(0, 0, false), 'NOT_STARTED');
  assert.equal(getWrappedBookOfYearStatus(4, 0, false), 'IN_PROGRESS');
  assert.equal(getWrappedBookOfYearStatus(12, 3, false), 'FINALISTS');
  assert.equal(getWrappedBookOfYearStatus(12, 3, true), 'COMPLETED');
});

test('Wrapped limita favoritos y consulta Libro del año por el año solicitado', () => {
  const source = readFileSync('src/services/checkin.service.ts', 'utf8');
  assert.match(source, /isFavorite: true[\s\S]*take: 5/);
  assert.match(source, /bookOfYearMonthlySelection\.findMany\([\s\S]*where: \{ userId, year \}/);
  assert.match(source, /bookOfYearFinalist\.findMany\([\s\S]*where: \{ userId, year \}/);
  assert.match(source, /bookOfYearWinner\.findUnique\([\s\S]*userId_year: \{ userId, year \}/);
  assert.match(source, /favoriteBooks:/);
  assert.match(source, /bookOfYear:/);
});
