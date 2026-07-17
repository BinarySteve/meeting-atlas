import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUserId } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";
import { db } from "@/lib/db";
import { EXPORT_FORMATS, renderExport } from "@/lib/exports";
import { newStorageKey, writeTextArtifact } from "@/lib/storage";

const formatSchema = z.enum(EXPORT_FORMATS);

export async function GET(request: Request, context: RouteContext<"/api/meetings/[id]/exports">) {
  let userId: string;
  try { userId = await requireUserId(); } catch { return NextResponse.json({ error: "Unauthorized" }, { status: 401 }); }
  const format = formatSchema.safeParse(new URL(request.url).searchParams.get("format"));
  if (!format.success) return NextResponse.json({ error: "Unsupported export format" }, { status: 400 });
  const { id } = await context.params;
  const meeting = await db.meeting.findUnique({ where: { id }, include: { recordings: true, speakers: true, transcriptVersions: { include: { segments: { include: { speaker: true } } } }, summaries: { include: { sections: true } }, actionItems: true, decisions: true, openQuestions: true } });
  if (!meeting) return NextResponse.json({ error: "Meeting not found" }, { status: 404 });
  const content = renderExport(meeting, format.data);
  const storageKey = newStorageKey("artifact", format.data);
  await writeTextArtifact(storageKey, content);
  const exported = await db.$transaction(async (tx) => {
    const row = await tx.export.create({ data: { meetingId: id, format: format.data, storageKey } });
    await writeAudit(tx, { userId, meetingId: id, action: "meeting.export", entityType: "Export", entityId: row.id, metadata: { format: format.data } });
    return row;
  });
  const safeTitle = meeting.title.replace(/[^a-z0-9_-]+/gi, "-").replace(/^-|-$/g, "").slice(0, 80) || "meeting";
  return new Response(content, { headers: { "content-type": contentType(format.data), "content-disposition": `attachment; filename="${safeTitle}.${format.data}"`, "cache-control": "private, no-store", "x-export-id": exported.id, "x-content-type-options": "nosniff" } });
}

function contentType(format: string): string {
  if (format === "json") return "application/json; charset=utf-8";
  if (format === "vtt") return "text/vtt; charset=utf-8";
  return "text/plain; charset=utf-8";
}
