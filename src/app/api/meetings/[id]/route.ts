import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUserId } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";
import { db } from "@/lib/db";
import { deleteMeetingData } from "@/lib/retention";

const patchSchema = z.object({
  retentionUntil: z.string().date().nullable().optional(),
  protectedFromRetention: z.boolean().optional(),
});

export async function PATCH(request: Request, context: RouteContext<"/api/meetings/[id]">) {
  let userId: string;
  try { userId = await requireUserId(); } catch { return NextResponse.json({ error: "Unauthorized" }, { status: 401 }); }
  const body = patchSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "Invalid retention settings" }, { status: 400 });
  const { id } = await context.params;
  const meeting = await db.meeting.findUnique({ where: { id }, select: { id: true } });
  if (!meeting) return NextResponse.json({ error: "Meeting not found" }, { status: 404 });
  await db.$transaction(async (tx) => {
    await tx.meeting.update({ where: { id }, data: { retentionUntil: body.data.retentionUntil ? new Date(`${body.data.retentionUntil}T12:00:00Z`) : body.data.retentionUntil, protectedFromRetention: body.data.protectedFromRetention } });
    await writeAudit(tx, { userId, meetingId: id, action: "meeting.retention.update", entityType: "Meeting", entityId: id, metadata: body.data });
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_request: Request, context: RouteContext<"/api/meetings/[id]">) {
  let userId: string;
  try { userId = await requireUserId(); } catch { return NextResponse.json({ error: "Unauthorized" }, { status: 401 }); }
  const { id } = await context.params;
  try { await deleteMeetingData(id, userId); }
  catch (error) {
    const message = error instanceof Error && ["Meeting not found", "Cannot delete meeting while processing is active", "Meeting data is busy; try again shortly"].includes(error.message) ? error.message : "Delete failed";
    return NextResponse.json({ error: message }, { status: message === "Meeting not found" ? 404 : 409 });
  }
  return NextResponse.json({ ok: true });
}
