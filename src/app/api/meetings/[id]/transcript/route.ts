import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUserId } from "@/lib/auth";
import { createEditedTranscriptVersion } from "@/lib/transcript-editing";

const bodySchema = z.object({
  baseVersionId: z.string().min(1),
  edit: z.discriminatedUnion("action", [
    z.object({ action: z.literal("edit_text"), segmentId: z.string(), text: z.string().max(20_000) }),
    z.object({ action: z.literal("reassign"), segmentId: z.string(), speakerId: z.string().nullable() }),
    z.object({ action: z.literal("exclude"), segmentId: z.string(), excluded: z.boolean() }),
    z.object({ action: z.literal("split"), segmentId: z.string(), characterIndex: z.number().int().positive(), splitMs: z.number().int().nonnegative().optional() }),
    z.object({ action: z.literal("merge"), segmentId: z.string(), nextSegmentId: z.string() }),
  ]),
});

export async function POST(request: Request, context: RouteContext<"/api/meetings/[id]/transcript">) {
  let userId: string;
  try { userId = await requireUserId(); } catch { return NextResponse.json({ error: "Unauthorized" }, { status: 401 }); }
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid transcript edit", details: parsed.error.flatten() }, { status: 400 });
  const { id } = await context.params;
  try {
    const version = await createEditedTranscriptVersion({ meetingId: id, userId, ...parsed.data });
    return NextResponse.json({ ok: true, version });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Transcript edit failed" }, { status: 409 });
  }
}
