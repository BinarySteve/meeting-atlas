import { ItemStatus } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUserId } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";
import { db } from "@/lib/db";

const bodySchema = z.object({
  description: z.string().trim().min(1).max(2_000).optional(),
  typedOwner: z.string().trim().max(200).nullable().optional(),
  dueDate: z.string().date().nullable().optional(),
  status: z.nativeEnum(ItemStatus).optional(),
  rejected: z.boolean().optional(),
});

export async function PATCH(request: Request, context: RouteContext<"/api/meetings/[id]/action-items/[itemId]">) {
  let userId: string;
  try { userId = await requireUserId(); } catch { return NextResponse.json({ error: "Unauthorized" }, { status: 401 }); }
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid action item update" }, { status: 400 });
  const { id, itemId } = await context.params;
  const item = await db.actionItem.findFirst({ where: { id: itemId, meetingId: id } });
  if (!item) return NextResponse.json({ error: "Action item not found" }, { status: 404 });
  const { rejected, ...updates } = parsed.data;
  await db.$transaction(async (tx) => {
    await tx.actionItem.update({
      where: { id: itemId },
      data: {
        ...updates,
        typedOwner: parsed.data.typedOwner || null,
        dueDate: parsed.data.dueDate ? new Date(`${parsed.data.dueDate}T00:00:00Z`) : parsed.data.dueDate,
        rejectedAt: rejected === undefined ? undefined : rejected ? new Date() : null,
        status: rejected ? "REJECTED" : parsed.data.status,
        manuallyEdited: true,
      },
    });
    await writeAudit(tx, { userId, meetingId: id, action: "action_item.update", entityType: "ActionItem", entityId: itemId, metadata: parsed.data });
  });
  return NextResponse.json({ ok: true });
}
