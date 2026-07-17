import { MeetingState, Prisma } from "@prisma/client";
import { db } from "./db";

export type MeetingSearch = {
  query?: string;
  speaker?: string;
  state?: MeetingState;
  uploadedFrom?: Date;
  uploadedTo?: Date;
  recordedFrom?: Date;
  recordedTo?: Date;
};

export async function searchMeetings(input: MeetingSearch) {
  const conditions: Prisma.Sql[] = [];
  if (input.state) conditions.push(Prisma.sql`m.state = ${input.state}::"MeetingState"`);
  if (input.uploadedFrom) conditions.push(Prisma.sql`m."createdAt" >= ${input.uploadedFrom}`);
  if (input.uploadedTo) conditions.push(Prisma.sql`m."createdAt" < ${input.uploadedTo}`);
  if (input.recordedFrom) conditions.push(Prisma.sql`m."recordingDate" >= ${input.recordedFrom}`);
  if (input.recordedTo) conditions.push(Prisma.sql`m."recordingDate" < ${input.recordedTo}`);
  if (input.speaker?.trim()) {
    conditions.push(Prisma.sql`EXISTS (
      SELECT 1 FROM "Speaker" sp
      WHERE sp."meetingId" = m.id
      AND to_tsvector('simple', sp."displayName") @@ websearch_to_tsquery('simple', ${input.speaker.trim()})
    )`);
  }
  if (input.query?.trim()) {
    const query = input.query.trim();
    conditions.push(Prisma.sql`(
      to_tsvector('simple', m.title) @@ websearch_to_tsquery('simple', ${query})
      OR EXISTS (SELECT 1 FROM "Speaker" sp WHERE sp."meetingId" = m.id AND to_tsvector('simple', sp."displayName") @@ websearch_to_tsquery('simple', ${query}))
      OR EXISTS (SELECT 1 FROM "TranscriptVersion" tv JOIN "TranscriptSegment" ts ON ts."transcriptVersionId" = tv.id WHERE tv."meetingId" = m.id AND to_tsvector('simple', ts.text) @@ websearch_to_tsquery('simple', ${query}))
      OR EXISTS (SELECT 1 FROM "ActionItem" ai WHERE ai."meetingId" = m.id AND to_tsvector('simple', ai.description || ' ' || COALESCE(ai."typedOwner", '')) @@ websearch_to_tsquery('simple', ${query}))
      OR EXISTS (SELECT 1 FROM "SummaryVersion" sv WHERE sv."meetingId" = m.id AND to_tsvector('simple', COALESCE(sv.content::text, '')) @@ websearch_to_tsquery('simple', ${query}))
    )`);
  }
  const where = conditions.length ? Prisma.sql`WHERE ${Prisma.join(conditions, " AND ")}` : Prisma.empty;
  const ids = await db.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT m.id FROM "Meeting" m
    ${where}
    ORDER BY m."createdAt" DESC
    LIMIT 100
  `);
  if (!ids.length) return [];
  const rows = await db.meeting.findMany({
    where: { id: { in: ids.map((row) => row.id) } },
    include: {
      speakers: { select: { displayName: true } },
      recordings: { select: { durationMs: true }, orderBy: { createdAt: "asc" }, take: 1 },
      summaries: { where: { status: "COMPLETED" }, select: { id: true }, take: 1 },
    },
  });
  const order = new Map(ids.map((row, index) => [row.id, index]));
  return rows.sort((left, right) => (order.get(left.id) ?? 0) - (order.get(right.id) ?? 0));
}
