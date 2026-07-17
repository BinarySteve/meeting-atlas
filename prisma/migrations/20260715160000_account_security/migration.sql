ALTER TABLE "User"
  ADD COLUMN "name" TEXT,
  ADD COLUMN "passwordChangedAt" TIMESTAMP(3);

ALTER TABLE "Session"
  ADD COLUMN "authMethod" TEXT NOT NULL DEFAULT 'UNKNOWN',
  ADD COLUMN "deviceLabel" TEXT,
  ADD COLUMN "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "Session"
  ADD CONSTRAINT "Session_authMethod_check"
  CHECK ("authMethod" IN ('PASSWORD', 'PASSKEY', 'UNKNOWN'));

CREATE INDEX "Session_userId_revokedAt_expiresAt_idx"
  ON "Session"("userId", "revokedAt", "expiresAt");

CREATE INDEX "AuditEvent_userId_createdAt_idx"
  ON "AuditEvent"("userId", "createdAt");
