import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";
import { db } from "@/lib/db";
import { selectedLlmModel } from "@/lib/llm-models";
import { assertExpectedOrigin } from "@/lib/passkeys";
import { processingModelsRequest } from "@/lib/processing-client";

const inputSchema = z.object({ model: z.string().trim().min(1).max(500) });

export async function GET() {
  let session;
  try {
    session = await requireSession();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const [models, model] = await Promise.all([
      processingModelsRequest(),
      selectedLlmModel(session.userId),
    ]);
    return NextResponse.json({ models, selectedModel: model });
  } catch {
    return NextResponse.json(
      { error: "Unable to read local LM Studio models." },
      { status: 503 },
    );
  }
}

export async function PATCH(request: Request) {
  if (!assertExpectedOrigin(request)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }
  let session;
  try {
    session = await requireSession();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const parsed = inputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Select a valid local model." }, { status: 400 });
  }
  try {
    const models = await processingModelsRequest();
    if (!models.some((model) => model.id === parsed.data.model)) {
      return NextResponse.json(
        { error: "That model is not available in LM Studio. Refresh the list and try again." },
        { status: 409 },
      );
    }
    await db.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: session.userId },
        data: { llmModel: parsed.data.model },
      });
      await writeAudit(tx, {
        userId: session.userId,
        action: "LLM_MODEL_CHANGED",
        entityType: "Account",
        entityId: session.userId,
        metadata: { model: parsed.data.model },
      });
    });
    return NextResponse.json({ ok: true, selectedModel: parsed.data.model });
  } catch {
    return NextResponse.json(
      { error: "Unable to update the local LLM model." },
      { status: 503 },
    );
  }
}
