import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";
import { createBackup, listBackups } from "@/lib/backups";
import { db } from "@/lib/db";
import { assertExpectedOrigin } from "@/lib/passkeys";

export const dynamic = "force-dynamic";

export async function GET() {
  try { await requireUserId(); } catch { return NextResponse.json({ error: "Unauthorized" }, { status: 401 }); }
  try { return NextResponse.json({ backups: await listBackups() }, { headers: { "Cache-Control": "no-store" } }); }
  catch { return NextResponse.json({ error: "Unable to list backups" }, { status: 500 }); }
}

export async function POST(request: Request) {
  if (!assertExpectedOrigin(request)) return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  let userId: string;
  try { userId = await requireUserId(); } catch { return NextResponse.json({ error: "Unauthorized" }, { status: 401 }); }
  try {
    const backup = await createBackup();
    await writeAudit(db, { userId, action: "backup.create", entityType: "Backup", entityId: backup.name, metadata: { size: backup.size } });
    return NextResponse.json({ backup }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Backup creation failed. Check backup storage and local database tools." }, { status: 500 });
  }
}
