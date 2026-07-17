-- CreateEnum
CREATE TYPE "MeetingState" AS ENUM ('UPLOADING', 'QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "JobState" AS ENUM ('QUEUED', 'ACTIVE', 'RETRYING', 'COMPLETED', 'FAILED', 'CANCEL_REQUESTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "StageState" AS ENUM ('PENDING', 'ACTIVE', 'COMPLETED', 'FAILED', 'SKIPPED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TranscriptSource" AS ENUM ('MACHINE', 'MANUAL');

-- CreateEnum
CREATE TYPE "ItemStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'COMPLETED', 'REJECTED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Meeting" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "recordingDate" TIMESTAMP(3),
    "state" "MeetingState" NOT NULL DEFAULT 'UPLOADING',
    "activeStage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Meeting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Recording" (
    "id" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "originalFilename" TEXT NOT NULL,
    "byteSize" BIGINT NOT NULL,
    "sha256" TEXT NOT NULL,
    "detectedFormat" TEXT,
    "durationMs" BIGINT,
    "sampleRate" INTEGER,
    "channels" INTEGER,
    "normalizedStorageKey" TEXT,
    "mediaMetadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Recording_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProcessingJob" (
    "id" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "state" "JobState" NOT NULL DEFAULT 'QUEUED',
    "activeStage" TEXT,
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "heartbeatAt" TIMESTAMP(3),
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "bullJobId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProcessingJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProcessingStageAttempt" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL,
    "state" "StageState" NOT NULL DEFAULT 'PENDING',
    "idempotencyKey" TEXT NOT NULL,
    "progressPositionMs" BIGINT,
    "result" JSONB,
    "logExcerpt" TEXT,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProcessingStageAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Speaker" (
    "id" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "diarizationKey" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Speaker_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SpeakerAlias" (
    "id" TEXT NOT NULL,
    "speakerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "validFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validTo" TIMESTAMP(3),

    CONSTRAINT "SpeakerAlias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TranscriptVersion" (
    "id" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "source" "TranscriptSource" NOT NULL,
    "parentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TranscriptVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TranscriptSegment" (
    "id" TEXT NOT NULL,
    "transcriptVersionId" TEXT NOT NULL,
    "speakerId" TEXT,
    "ordinal" INTEGER NOT NULL,
    "startMs" BIGINT NOT NULL,
    "endMs" BIGINT NOT NULL,
    "text" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION,
    "assignmentConfidence" DOUBLE PRECISION,
    "assignmentReason" TEXT,
    "excludedFromSummary" BOOLEAN NOT NULL DEFAULT false,
    "sourceSegmentIds" TEXT[],

    CONSTRAINT "TranscriptSegment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RawTranscriptionArtifact" (
    "id" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "stageAttemptId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "modelName" TEXT NOT NULL,
    "backend" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RawTranscriptionArtifact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RawDiarizationArtifact" (
    "id" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "stageAttemptId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "modelName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RawDiarizationArtifact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SummaryVersion" (
    "id" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "transcriptVersionId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "StageState" NOT NULL,
    "modelName" TEXT NOT NULL,
    "content" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SummaryVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SectionSummary" (
    "id" TEXT NOT NULL,
    "summaryVersionId" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "startMs" BIGINT NOT NULL,
    "endMs" BIGINT NOT NULL,
    "evidenceSegmentIds" TEXT[],
    "content" JSONB NOT NULL,

    CONSTRAINT "SectionSummary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActionItem" (
    "id" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "assignedSpeakerId" TEXT,
    "typedOwner" TEXT,
    "dueDate" TIMESTAMP(3),
    "status" "ItemStatus" NOT NULL DEFAULT 'OPEN',
    "confidence" DOUBLE PRECISION,
    "evidenceSegmentIds" TEXT[],
    "creationSource" TEXT NOT NULL,
    "manuallyEdited" BOOLEAN NOT NULL DEFAULT false,
    "rejectedAt" TIMESTAMP(3),

    CONSTRAINT "ActionItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Decision" (
    "id" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION,
    "evidenceSegmentIds" TEXT[],
    "rejectedAt" TIMESTAMP(3),

    CONSTRAINT "Decision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OpenQuestion" (
    "id" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "evidenceSegmentIds" TEXT[],
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "OpenQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Export" (
    "id" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Export_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "meetingId" TEXT,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "Meeting_state_createdAt_idx" ON "Meeting"("state", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Recording_storageKey_key" ON "Recording"("storageKey");

-- CreateIndex
CREATE UNIQUE INDEX "ProcessingJob_bullJobId_key" ON "ProcessingJob"("bullJobId");

-- CreateIndex
CREATE UNIQUE INDEX "ProcessingStageAttempt_idempotencyKey_key" ON "ProcessingStageAttempt"("idempotencyKey");

-- CreateIndex
CREATE INDEX "ProcessingStageAttempt_jobId_stage_state_idx" ON "ProcessingStageAttempt"("jobId", "stage", "state");

-- CreateIndex
CREATE UNIQUE INDEX "ProcessingStageAttempt_jobId_stage_attempt_key" ON "ProcessingStageAttempt"("jobId", "stage", "attempt");

-- CreateIndex
CREATE UNIQUE INDEX "Speaker_meetingId_diarizationKey_key" ON "Speaker"("meetingId", "diarizationKey");

-- CreateIndex
CREATE UNIQUE INDEX "TranscriptVersion_meetingId_version_key" ON "TranscriptVersion"("meetingId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "TranscriptSegment_transcriptVersionId_ordinal_key" ON "TranscriptSegment"("transcriptVersionId", "ordinal");

-- CreateIndex
CREATE UNIQUE INDEX "RawTranscriptionArtifact_stageAttemptId_key" ON "RawTranscriptionArtifact"("stageAttemptId");

-- CreateIndex
CREATE UNIQUE INDEX "RawTranscriptionArtifact_storageKey_key" ON "RawTranscriptionArtifact"("storageKey");

-- CreateIndex
CREATE UNIQUE INDEX "RawDiarizationArtifact_stageAttemptId_key" ON "RawDiarizationArtifact"("stageAttemptId");

-- CreateIndex
CREATE UNIQUE INDEX "RawDiarizationArtifact_storageKey_key" ON "RawDiarizationArtifact"("storageKey");

-- CreateIndex
CREATE UNIQUE INDEX "SummaryVersion_meetingId_version_key" ON "SummaryVersion"("meetingId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "SectionSummary_summaryVersionId_ordinal_key" ON "SectionSummary"("summaryVersionId", "ordinal");

-- AddForeignKey
ALTER TABLE "Recording" ADD CONSTRAINT "Recording_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcessingJob" ADD CONSTRAINT "ProcessingJob_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcessingStageAttempt" ADD CONSTRAINT "ProcessingStageAttempt_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "ProcessingJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Speaker" ADD CONSTRAINT "Speaker_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpeakerAlias" ADD CONSTRAINT "SpeakerAlias_speakerId_fkey" FOREIGN KEY ("speakerId") REFERENCES "Speaker"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TranscriptVersion" ADD CONSTRAINT "TranscriptVersion_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TranscriptSegment" ADD CONSTRAINT "TranscriptSegment_transcriptVersionId_fkey" FOREIGN KEY ("transcriptVersionId") REFERENCES "TranscriptVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TranscriptSegment" ADD CONSTRAINT "TranscriptSegment_speakerId_fkey" FOREIGN KEY ("speakerId") REFERENCES "Speaker"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SummaryVersion" ADD CONSTRAINT "SummaryVersion_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SummaryVersion" ADD CONSTRAINT "SummaryVersion_transcriptVersionId_fkey" FOREIGN KEY ("transcriptVersionId") REFERENCES "TranscriptVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SectionSummary" ADD CONSTRAINT "SectionSummary_summaryVersionId_fkey" FOREIGN KEY ("summaryVersionId") REFERENCES "SummaryVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActionItem" ADD CONSTRAINT "ActionItem_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActionItem" ADD CONSTRAINT "ActionItem_assignedSpeakerId_fkey" FOREIGN KEY ("assignedSpeakerId") REFERENCES "Speaker"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Decision" ADD CONSTRAINT "Decision_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpenQuestion" ADD CONSTRAINT "OpenQuestion_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Export" ADD CONSTRAINT "Export_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
