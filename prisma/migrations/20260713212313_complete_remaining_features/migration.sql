-- CreateEnum
CREATE TYPE "JobKind" AS ENUM ('AUDIO_PIPELINE', 'SUMMARY_REGENERATION');

-- AlterTable
ALTER TABLE "ActionItem" ADD COLUMN     "summaryVersionId" TEXT;

-- AlterTable
ALTER TABLE "Decision" ADD COLUMN     "summaryVersionId" TEXT;

-- AlterTable
ALTER TABLE "Meeting" ADD COLUMN     "activeSummaryVersionId" TEXT,
ADD COLUMN     "protectedFromRetention" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "retentionUntil" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "OpenQuestion" ADD COLUMN     "summaryVersionId" TEXT;

-- AlterTable
ALTER TABLE "ProcessingJob" ADD COLUMN     "kind" "JobKind" NOT NULL DEFAULT 'AUDIO_PIPELINE',
ADD COLUMN     "targetTranscriptVersionId" TEXT;

-- CreateIndex
CREATE INDEX "ActionItem_meetingId_summaryVersionId_idx" ON "ActionItem"("meetingId", "summaryVersionId");

-- CreateIndex
CREATE INDEX "AuditEvent_meetingId_createdAt_idx" ON "AuditEvent"("meetingId", "createdAt");

-- CreateIndex
CREATE INDEX "Decision_meetingId_summaryVersionId_idx" ON "Decision"("meetingId", "summaryVersionId");

-- CreateIndex
CREATE INDEX "Meeting_retentionUntil_protectedFromRetention_idx" ON "Meeting"("retentionUntil", "protectedFromRetention");

-- CreateIndex
CREATE INDEX "OpenQuestion_meetingId_summaryVersionId_idx" ON "OpenQuestion"("meetingId", "summaryVersionId");

-- AddForeignKey
ALTER TABLE "ActionItem" ADD CONSTRAINT "ActionItem_summaryVersionId_fkey" FOREIGN KEY ("summaryVersionId") REFERENCES "SummaryVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Decision" ADD CONSTRAINT "Decision_summaryVersionId_fkey" FOREIGN KEY ("summaryVersionId") REFERENCES "SummaryVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpenQuestion" ADD CONSTRAINT "OpenQuestion_summaryVersionId_fkey" FOREIGN KEY ("summaryVersionId") REFERENCES "SummaryVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
