import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { clubBookOfYearBracketSize } from '../src/services/club-book-of-year.service.js';

test('elige cuadros completos para 2, 3, 4, 5, 8 y más candidaturas', () => {
  assert.equal(clubBookOfYearBracketSize(2), 2);
  assert.equal(clubBookOfYearBracketSize(3), 2);
  assert.equal(clubBookOfYearBracketSize(4), 4);
  assert.equal(clubBookOfYearBracketSize(5), 4);
  assert.equal(clubBookOfYearBracketSize(8), 8);
  assert.equal(clubBookOfYearBracketSize(12), 8);
});

test('usa modelos, votos y ganadores separados del Libro del año personal', () => {
  const schema = readFileSync('prisma/schema.prisma', 'utf8');
  for (const model of ['ClubBookOfYearEdition', 'ClubBookOfYearCandidate', 'ClubBookOfYearRound', 'ClubBookOfYearDuel', 'ClubBookOfYearQualifyingVote', 'ClubBookOfYearDuelVote']) assert.match(schema, new RegExp(`model ${model}`));
  assert.match(schema, /@@unique\(\[clubId, year\]\)/);
  assert.match(schema, /@@unique\(\[duelId, userId\]\)/);
});

test('candidaturas proceden de lecturas oficiales finalizadas y se deduplican por bookId', () => {
  const source = readFileSync('src/services/club-book-of-year.service.ts', 'utf8');
  assert.match(source, /type: ReadingType\.CLUBVISION/);
  assert.match(source, /status: ReadingSessionStatus\.FINISHED/);
  assert.match(source, /finishedAt: yearRange\(year\)/);
  assert.match(source, /new Map<string[\s\S]*unique\.set\(reading\.bookId/);
});

test('valida membresía, roles, voto mutable y cierre transaccional', () => {
  const source = readFileSync('src/services/club-book-of-year.service.ts', 'utf8');
  assert.match(source, /requireClubMember/);
  assert.match(source, /requireClubRole/);
  assert.match(source, /clubBookOfYearDuelVote\.upsert/);
  assert.match(source, /DUEL_WITHOUT_VOTES/);
  assert.match(source, /ClubBookOfYearPhase\.TIEBREAK/);
  assert.match(source, /tiedDuels/);
  assert.match(source, /prisma\.\$transaction/);
});

test('rechaza espacios personales y mantiene el aislamiento por club activo', () => {
  const source = readFileSync('src/services/club-book-of-year.service.ts', 'utf8');
  assert.match(source, /context\.club\.tipo !== ClubType\.SOCIAL/);
  assert.match(source, /SOCIAL_CLUB_REQUIRED/);
  assert.match(source, /requireSocialClubMember/);
  assert.match(source, /requireSocialClubAdmin/);
  assert.match(source, /clubId_year: \{ clubId: club\.id, year \}/);
  assert.match(source, /edition: \{ clubId: club\.id, year \}/);
});
