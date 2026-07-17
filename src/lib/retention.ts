import { db } from "./db";
import { removeStorageKey } from "./storage";
import { writeAudit } from "./audit";

export async function deleteMeetingData(meetingId: string, userId?: string): Promise<void> {
  const meeting = await db.meeting.findUnique({
    where: { id: meetingId },
    include: { recordings: true, exports: true },
  });
  if (!meeting) throw new Error("Meeting not found");
  const activeJobs = await db.processingJob.count({
    where: { meetingId, state: { in: ["QUEUED", "ACTIVE", "RETRYING", "CANCEL_REQUESTED"] } },
  });
  if (activeJobs) throw new Error("Cannot delete meeting while processing is active");
  const [transcriptionArtifacts, diarizationArtifacts] = await Promise.all([
    db.rawTranscriptionArtifact.findMany({ where: { meetingId }, select: { storageKey: true } }),
    db.rawDiarizationArtifact.findMany({ where: { meetingId }, select: { storageKey: true } }),
  ]);
  const keys = new Set([
    ...meeting.recordings.flatMap((recording) => [recording.storageKey, ...(recording.normalizedStorageKey ? [recording.normalizedStorageKey] : [])]),
    ...meeting.exports.map((item) => item.storageKey),
    ...transcriptionArtifacts.map((item) => item.storageKey),
    ...diarizationArtifacts.map((item) => item.storageKey),
  ]);
  for (const key of keys) await removeStorageKey(key);
  await db.$transaction(async (tx) => {
    await writeAudit(tx, { userId, action: "meeting.delete", entityType: "Meeting", entityId: meetingId, metadata: { title: meeting.title, storageObjectsDeleted: keys.size } });
    await tx.meeting.delete({ where: { id: meetingId } });
  });
}
