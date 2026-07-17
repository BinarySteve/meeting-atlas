ALTER TABLE "ProcessingStageAttempt"
ADD COLUMN "progressCurrent" INTEGER,
ADD COLUMN "progressTotal" INTEGER,
ADD COLUMN "progressMessage" TEXT;

CREATE UNIQUE INDEX "ProcessingJob_one_active_per_meeting"
ON "ProcessingJob" ("meetingId")
WHERE "state" IN ('QUEUED', 'ACTIVE', 'RETRYING', 'CANCEL_REQUESTED');
