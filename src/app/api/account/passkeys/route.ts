import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth";
import { db } from "@/lib/db";

export async function GET() {
  try { const userId = await requireUserId(); const passkeys = await db.passkey.findMany({ where: { userId }, select: { id: true, name: true, deviceType: true, backedUp: true, createdAt: true, lastUsedAt: true }, orderBy: { createdAt: "desc" } }); return NextResponse.json({ passkeys }, { headers: { "Cache-Control": "no-store" } }); }
  catch { return NextResponse.json({ error: "Unauthorized" }, { status: 401 }); }
}
