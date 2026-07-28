import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const schema = readFileSync(
  new URL('../prisma/schema.prisma', import.meta.url),
  'utf8',
);
const migration = readFileSync(
  new URL(
    '../prisma/migrations/20260728150000_scope_mood_votes_by_club/migration.sql',
    import.meta.url,
  ),
  'utf8',
);

test('Clubvisión se identifica por club y edición', () => {
  const clubvision = schema.match(
    /model Clubvision \{[\s\S]*?\n\}/,
  )?.[0];
  const result = schema.match(
    /model ClubvisionResult \{[\s\S]*?\n\}/,
  )?.[0];

  assert.ok(clubvision);
  assert.ok(result);
  assert.match(clubvision, /@@unique\(\[clubId, edition\]\)/);
  assert.match(result, /@@unique\(\[clubId, edition\]\)/);
  assert.doesNotMatch(clubvision, /edition\s+String\s+@unique/);
  assert.doesNotMatch(result, /edition\s+String\s+@unique/);
});

test('las entidades comunitarias no permiten clubId nulo', () => {
  for (const model of [
    'ClubMoodVote',
    'Reading',
    'Clubvision',
    'ClubvisionResult',
  ]) {
    const definition = schema.match(
      new RegExp(`model ${model} \\{[\\s\\S]*?\\n\\}`),
    )?.[0];

    assert.ok(definition, `No se encontró ${model}`);
    assert.match(definition, /clubId\s+String\b/);
    assert.doesNotMatch(definition, /clubId\s+String\?/);
  }
});

test('la migración endurece el aislamiento después del backfill', () => {
  for (const table of [
    'Reading',
    'Clubvision',
    'ClubvisionResult',
    'ClubMoodVote',
  ]) {
    assert.match(
      migration,
      new RegExp(
        `ALTER TABLE "${table}" ALTER COLUMN "clubId" SET NOT NULL`,
      ),
    );
  }

  assert.match(
    migration,
    /CREATE UNIQUE INDEX "Clubvision_clubId_edition_key"/,
  );
  assert.match(
    migration,
    /CREATE UNIQUE INDEX "ClubvisionResult_clubId_edition_key"/,
  );
  assert.match(
    migration,
    /CREATE UNIQUE INDEX "Reading_one_active_per_club_book"/,
  );
  assert.match(
    migration,
    /FOREIGN KEY \("candidateId", "clubvisionId"\)/,
  );
});
