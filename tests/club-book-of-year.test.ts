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

test('combina resultados históricos y lecturas oficiales con resolución segura', () => {
  const source = readFileSync('src/services/club-book-of-year.service.ts', 'utf8');
  assert.match(source, /clubvisionResult\.findMany/);
  assert.match(source, /edition: \{ startsWith: `\$\{year\}-` \}/);
  assert.match(source, /enrichClubvisionHistoryRows/);
  assert.match(source, /unresolvedCandidates/);
  assert.match(source, /source: 'CLUBVISION'/);
  assert.match(source, /source: 'OFFICIAL_READING'/);
  assert.match(source, /if \(unique\.has\(reading\.bookId\)\) continue/);
  assert.match(source, /sortKey\.localeCompare/);
});

test('preparación y sincronización reutilizan eligible y la vinculación no altera ClubvisionResult', () => {
  const source = readFileSync('src/services/club-book-of-year.service.ts', 'utf8');
  assert.match(source, /syncClubBookOfYearCandidates[\s\S]*await eligible\(clubId, year, tx\)/);
  assert.match(source, /clubBookOfYearHistoricalLink\.upsert/);
  assert.doesNotMatch(source, /clubvisionResult\.update\([\s\S]*winnerBookId/);
});

test('PREPARING sincroniza sin votar y congela únicamente al abrir', () => {
  const source = readFileSync('src/services/club-book-of-year.service.ts', 'utf8');
  assert.match(source, /status: ClubBookOfYearStatus\.PREPARING/);
  assert.match(source, /clubBookOfYearCandidate\.upsert/);
  assert.match(source, /existingIds[\s\S]*added/);
  assert.match(source, /edition\.status !== ClubBookOfYearStatus\.PREPARING/);
  assert.match(source, /openClubBookOfYearVoting[\s\S]*syncClubBookOfYearCandidates/);
  assert.match(source, /ROUND_OPEN/);
  assert.match(source, /VOTING_CLOSED/);
});
