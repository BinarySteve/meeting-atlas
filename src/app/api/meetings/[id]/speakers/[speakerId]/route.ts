import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUserId } from "@/lib/auth";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";

const bodySchema = z.object({ displayName: z.string().trim().min(1).max(100) });

export async function PATCH(request: Request, context: RouteContext<"/api/meetings/[id]/speakers/[speakerId]">) {
  let userId: string;
  try { userId = await requireUserId(); } catch { return NextResponse.json({ error: "Unauthorized" }, { status: 401 }); }
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid speaker name" }, { status: 400 });
  const { id, speakerId } = await context.params;
  const speaker = await db.speaker.findFirst({ where: { id: speakerId, meetingId: id } });
  if (!speaker) return NextResponse.json({ error: "Speaker not found" }, { status: 404 });
  await db.$transaction(async (tx) => {
    await tx.speakerAlias.updateMany({ where: { speakerId, validTo: null }, data: { validTo: new Date() } });
    await tx.speakerAlias.create({ data: { speakerId, name: parsed.data.displayName } });
    await tx.speaker.update({ where: { id: speakerId }, data: { displayName: parsed.data.displayName } });
    await writeAudit(tx, { userId, meetingId: id, action: "speaker.rename", entityType: "Speaker", entityId: speakerId, metadata: { previousName: speaker.displayName, newName: parsed.data.displayName } });
  });
  return NextResponse.json({ ok: true });
}
