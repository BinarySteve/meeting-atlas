ALTER TYPE "JobKind" ADD VALUE 'TRANSCRIPT_REPROCESS';

ALTER TABLE "Meeting" ADD COLUMN "activeTranscriptVersionId" TEXT;

UPDATE "Meeting" AS meeting
SET "activeTranscriptVersionId" = latest.id
FROM (
  SELECT DISTINCT ON ("meetingId") id, "meetingId"
  FROM "TranscriptVersion"
  ORDER BY "meetingId", version DESC
) AS latest
WHERE latest."meetingId" = meeting.id;

CREATE UNIQUE INDEX "Meeting_activeTranscriptVersionId_key"
ON "Meeting"("activeTranscriptVersionId");

ALTER TABLE "Meeting"
ADD CONSTRAINT "Meeting_activeTranscriptVersionId_fkey"
FOREIGN KEY ("activeTranscriptVersionId") REFERENCES "TranscriptVersion"(id)
ON DELETE SET NULL ON UPDATE CASCADE;
