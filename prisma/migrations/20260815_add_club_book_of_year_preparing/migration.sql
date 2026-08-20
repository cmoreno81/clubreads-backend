ALTER TABLE "ClubBookOfYearEdition"
  ADD COLUMN "candidatesSyncedAt" TIMESTAMP(3);

ALTER TABLE "ClubBookOfYearCandidate"
  ADD COLUMN "source" TEXT NOT NULL DEFAULT 'OFFICIAL_READING',
  ADD COLUMN "clubvisionEdition" TEXT,
  ADD COLUMN "needsReview" BOOLEAN NOT NULL DEFAULT false;

-- Una edición sin votos, resultados ni rondas abiertas puede volver a preparación.
-- Se eliminan únicamente sus emparejamientos todavía pendientes para que la lista
-- pueda sincronizarse de nuevo antes de abrir la votación.
DELETE FROM "ClubBookOfYearRound" r
WHERE r."status" = 'PENDING'
  AND EXISTS (
    SELECT 1 FROM "ClubBookOfYearEdition" e
    WHERE e."id" = r."editionId"
      AND e."status" NOT IN ('FINISHED', 'CANCELLED', 'PREPARING')
      AND e."winnerCandidateId" IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM "ClubBookOfYearQualifyingVote" qv
        WHERE qv."editionId" = e."id"
      )
      AND NOT EXISTS (
        SELECT 1
        FROM "ClubBookOfYearRound" vr
        JOIN "ClubBookOfYearDuel" d ON d."roundId" = vr."id"
        JOIN "ClubBookOfYearDuelVote" dv ON dv."duelId" = d."id"
        WHERE vr."editionId" = e."id"
      )
      AND NOT EXISTS (
        SELECT 1 FROM "ClubBookOfYearRound" opened
        WHERE opened."editionId" = e."id" AND opened."status" <> 'PENDING'
      )
  );

UPDATE "ClubBookOfYearEdition" e
SET "status" = 'PREPARING', "bracketSize" = NULL,
    "startedAt" = NULL, "candidatesSyncedAt" = CURRENT_TIMESTAMP
WHERE e."status" NOT IN ('FINISHED', 'CANCELLED', 'PREPARING')
  AND e."winnerCandidateId" IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM "ClubBookOfYearQualifyingVote" qv
    WHERE qv."editionId" = e."id"
  )
  AND NOT EXISTS (
    SELECT 1
    FROM "ClubBookOfYearRound" r
    JOIN "ClubBookOfYearDuel" d ON d."roundId" = r."id"
    JOIN "ClubBookOfYearDuelVote" dv ON dv."duelId" = d."id"
    WHERE r."editionId" = e."id"
  )
  AND NOT EXISTS (
    SELECT 1 FROM "ClubBookOfYearRound" r
    WHERE r."editionId" = e."id"
  );
