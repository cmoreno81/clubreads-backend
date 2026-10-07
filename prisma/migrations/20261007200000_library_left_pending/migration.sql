-- AlterTable
ALTER TABLE "Library" ADD COLUMN "leftPendingAt" TIMESTAMP(3);

-- Guarda el momento exacto en que un libro deja de ser pendiente (y lo borra
-- si vuelve a serlo), venga el cambio de donde venga.
CREATE OR REPLACE FUNCTION library_track_left_pending() RETURNS trigger AS $$
BEGIN
  IF OLD."status" = 'PENDING' AND NEW."status" <> 'PENDING' THEN
    NEW."leftPendingAt" := (now() AT TIME ZONE 'UTC');
  ELSIF OLD."status" <> 'PENDING' AND NEW."status" = 'PENDING' THEN
    NEW."leftPendingAt" := NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER library_left_pending
BEFORE UPDATE OF "status" ON "Library"
FOR EACH ROW EXECUTE FUNCTION library_track_left_pending();
