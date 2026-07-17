import { db } from "../src/lib/db";
import { getEnv } from "../src/lib/env";
import { deleteMeetingData } from "../src/lib/retention";

async function main(): Promise<void> {
  const now = new Date();
  const days = getEnv().RETENTION_DAYS;
  const defaultCutoff = new Date(now.getTime() - days * 86_400_000);
  const meetings = await db.meeting.findMany({
    where: {
      protectedFromRetention: false,
      OR: [
        { retentionUntil: { lte: now } },
        ...(days > 0 ? [{ retentionUntil: null, createdAt: { lte: defaultCutoff } }] : []),
      ],
    },
    select: { id: true },
  });
  for (const meeting of meetings) {
    try { await deleteMeetingData(meeting.id); }
    catch (error) { console.error(JSON.stringify({ event: "retention_failed", meetingId: meeting.id, error: error instanceof Error ? error.message : "unknown" })); }
  }
  console.log(JSON.stringify({ event: "retention_complete", deleted: meetings.length }));
}

main().finally(() => db.$disconnect()).catch((error: unknown) => { console.error(error instanceof Error ? error.message : "Retention failed"); process.exitCode = 1; });
