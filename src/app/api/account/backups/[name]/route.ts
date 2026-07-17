import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";
import { deleteBackup, getBackupDownload, verifyBackup } from "@/lib/backups";
import { db } from "@/lib/db";
import { assertExpectedOrigin } from "@/lib/passkeys";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ name: string }> }) {
  try { await requireUserId(); } catch { return NextResponse.json({ error: "Unauthorized" }, { status: 401 }); }
  try {
    const { name } = await context.params;
    const backup = await getBackupDownload(name);
    return new Response(Readable.toWeb(backup.stream) as ReadableStream, { headers: {
      "Content-Type": "application/gzip",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Content-Length": String(backup.size),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    } });
  } catch {
    return NextResponse.json({ error: "Backup not found" }, { status: 404 });
  }
}

export async function POST(request: Request, context: { params: Promise<{ name: string }> }) {
  if (!assertExpectedOrigin(request)) return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  let userId: string;
  try { userId = await requireUserId(); } catch { return NextResponse.json({ error: "Unauthorized" }, { status: 401 }); }
  const { name } = await context.params;
  try {
    const verification = await verifyBackup(name);
    await writeAudit(db, { userId, action: "backup.verify", entityType: "Backup", entityId: name, metadata: { files: verification.files, bytes: verification.bytes } });
    return NextResponse.json({ verification });
  } catch {
    return NextResponse.json({ error: "Backup verification failed" }, { status: 422 });
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ name: string }> }) {
  if (!assertExpectedOrigin(request)) return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  let userId: string;
  try { userId = await requireUserId(); } catch { return NextResponse.json({ error: "Unauthorized" }, { status: 401 }); }
  const { name } = await context.params;
  try {
    await deleteBackup(name);
    await writeAudit(db, { userId, action: "backup.delete", entityType: "Backup", entityId: name });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Backup could not be deleted" }, { status: 404 });
  }
}
