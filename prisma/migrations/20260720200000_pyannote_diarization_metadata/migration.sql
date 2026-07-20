ALTER TABLE "RawDiarizationArtifact"
ADD COLUMN "backend" TEXT NOT NULL DEFAULT 'wespeaker',
ADD COLUMN "configFingerprint" TEXT,
ADD COLUMN "normalizedStorageKey" TEXT;

ALTER TABLE "RawDiarizationArtifact"
ALTER COLUMN "backend" DROP DEFAULT;
