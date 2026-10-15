import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const dash = readFileSync('src/services/dashboard.service.ts', 'utf8');
const rank = readFileSync('src/services/ranking.service.ts', 'utf8');

test('el podio del mes no descarta una relectura hecha en la app de un libro que se importó antes', () => {
  assert.match(dash, /trackedInApp: true, finishedAt: true/);
  assert.match(dash, /c\.trackedInApp \|\| !importedRankingKeys\.has/);
});

test('en un empate del podio gana quien llegó antes a esa cifra (dashboard y ranking)', () => {
  assert.match(dash, /compararLectoras/);
  assert.match(dash, /ultimaPorNombre\.get\(a\[0\]\)/);
  assert.match(rank, /a\[1\]\.ultima - b\[1\]\.ultima/);
});
