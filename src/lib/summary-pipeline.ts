import type { Prisma } from "@prisma/client";
import { db } from "./db";
import { getEnv } from "./env";
import { runStage } from "./pipeline";
import { publishProcessingUpdate } from "./processing-status";
import { processingJsonRequest } from "./processing-client";
import {
  FINAL_SYSTEM_PROMPT,
  type MeetingOutput,
  meetingOutputJsonSchema,
  meetingOutputSchema,
  SECTION_SYSTEM_PROMPT,
  sectionTranscript,
  validateEvidence,
} from "./summarization";

type StructuredRequest = typeof processingJsonRequest;

export async function requestValidatedMeetingOutput(
  system: string,
  source: string,
  allowedIds: Set<string>,
  signal: AbortSignal,
  requestId: string,
  request: StructuredRequest = processingJsonRequest,
): Promise<MeetingOutput> {
  const allowed = [...allowedIds];
  const constrainedSource = `Allowed evidence segment IDs (copy exactly; no other IDs are valid):\n${JSON.stringify(allowed)}\n\nSource:\n${source}`;
  const response = await request("llm/structured", {
    system,
    user: constrainedSource,
    schema: meetingOutputJsonSchema,
  }, signal, requestId);
  try {
    return validateEvidence(meetingOutputSchema.parse(response.content), allowedIds);
  } catch (error) {
    const reason = error instanceof Error ? error.message.slice(0, 2_000) : "Invalid structured output";
    const repaired = await request("llm/structured", {
      system: `${system}\nThis is one repair attempt. Correct the prior output. Do not introduce evidence IDs outside the exact allowlist. Remove an unsupported item instead of guessing evidence.`,
      user: `${constrainedSource}\n\nPrior invalid output:\n${JSON.stringify(response.content)}\n\nValidation error:\n${reason}`,
      schema: meetingOutputJsonSchema,
    }, signal, `${requestId}:repair`);
    return validateEvidence(meetingOutputSchema.parse(repaired.content), allowedIds);
  }
}

export async function runSummaryPipeline(
  jobId: string,
  meetingId: string,
  transcriptVersionId: string,
  options: { activate?: boolean } = {},
): Promise<string> {
  const env = getEnv();
  await runStage(jobId, "summarization", async (stageAttemptId, signal) => {
    const transcript = await db.transcriptVersion.findFirstOrThrow({
      where: { id: transcriptVersionId, meetingId },
      include: { segments: { orderBy: { ordinal: "asc" } } },
    });
    const sections = sectionTranscript(transcript.segments);
    if (!sections.length) throw new Error("No transcript sections are included in summary");
    let summary = await db.summaryVersion.findFirst({
      where: { meetingId, transcriptVersionId, status: "ACTIVE" },
      orderBy: { version: "desc" },
    });
    if (!summary) {
      const latest = await db.summaryVersion.aggregate({
        where: { meetingId },
        _max: { version: true },
      });
      summary = await db.summaryVersion.create({
        data: {
          meetingId,
          transcriptVersionId,
          version: (latest._max.version ?? 0) + 1,
          status: "ACTIVE",
          modelName: env.LM_STUDIO_MODEL,
        },
      });
    }
    const existingCount = await db.sectionSummary.count({ where: { summaryVersionId: summary.id } });
    await db.processingStageAttempt.update({ where: { id: stageAttemptId }, data: { progressCurrent: existingCount, progressTotal: sections.length, progressMessage: existingCount ? `Resuming section ${Math.min(existingCount + 1, sections.length)} of ${sections.length}` : `Summarizing section 1 of ${sections.length}` } });
    await publishProcessingUpdate(meetingId);
    let completed = existingCount;
    for (const section of sections) {
      const existing = await db.sectionSummary.findUnique({
        where: { summaryVersionId_ordinal: { summaryVersionId: summary.id, ordinal: section.ordinal } },
      });
      if (existing) continue;
      const content = await requestValidatedMeetingOutput(
        SECTION_SYSTEM_PROMPT,
        section.text,
        new Set(section.segmentIds),
        signal,
        `${stageAttemptId}:${section.ordinal}`,
      );
      await db.sectionSummary.create({
        data: {
          summaryVersionId: summary.id,
          ordinal: section.ordinal,
          startMs: section.startMs,
          endMs: section.endMs,
          evidenceSegmentIds: section.segmentIds,
          content: content as Prisma.InputJsonValue,
        },
      });
      completed += 1;
      await db.processingStageAttempt.update({ where: { id: stageAttemptId }, data: { progressCurrent: completed, progressTotal: sections.length, progressMessage: completed === sections.length ? "Section summaries complete" : `Summarizing section ${completed + 1} of ${sections.length}` } });
      await publishProcessingUpdate(meetingId);
    }
    return { summaryVersionId: summary.id, sectionCount: sections.length };
  });

  await runStage(jobId, "structured_extraction", async (stageAttemptId, signal) => {
    await db.processingStageAttempt.update({ where: { id: stageAttemptId }, data: { progressCurrent: 0, progressTotal: 1, progressMessage: "Extracting summary, action items, decisions, and questions" } });
    await publishProcessingUpdate(meetingId);
    const summary = await db.summaryVersion.findFirstOrThrow({
      where: { meetingId, transcriptVersionId, status: "ACTIVE" },
      orderBy: { version: "desc" },
      include: {
        sections: { orderBy: { ordinal: "asc" } },
        transcriptVersion: { include: { segments: true } },
      },
    });
    const content = await requestValidatedMeetingOutput(
      FINAL_SYSTEM_PROMPT,
      JSON.stringify(summary.sections.map((section) => section.content)),
      new Set(summary.transcriptVersion.segments.map((segment) => segment.id)),
      signal,
      stageAttemptId,
    );
    await db.$transaction(async (tx) => {
      await Promise.all([
        tx.actionItem.deleteMany({ where: { summaryVersionId: summary.id } }),
        tx.decision.deleteMany({ where: { summaryVersionId: summary.id } }),
        tx.openQuestion.deleteMany({ where: { summaryVersionId: summary.id } }),
      ]);
      await tx.summaryVersion.update({
        where: { id: summary.id },
        data: { status: "COMPLETED", content: content as Prisma.InputJsonValue },
      });
      if (options.activate !== false) {
        await tx.meeting.update({
          where: { id: meetingId },
          data: { activeSummaryVersionId: summary.id, activeTranscriptVersionId: transcriptVersionId },
        });
      }
      if (content.actionItems.length) {
        await tx.actionItem.createMany({
          data: content.actionItems.map((item) => ({
            meetingId,
            summaryVersionId: summary.id,
            description: item.description,
            typedOwner: item.owner,
            dueDate: item.dueDate ? new Date(`${item.dueDate}T00:00:00Z`) : null,
            confidence: item.confidence,
            evidenceSegmentIds: item.evidenceSegmentIds,
            creationSource: "local_llm",
          })),
        });
      }
      if (content.decisions.length) {
        await tx.decision.createMany({
          data: content.decisions.map((item) => ({
            meetingId,
            summaryVersionId: summary.id,
            text: item.text,
            confidence: item.confidence,
            evidenceSegmentIds: item.evidenceSegmentIds,
          })),
        });
      }
      if (content.openQuestions.length) {
        await tx.openQuestion.createMany({
          data: content.openQuestions.map((item) => ({
            meetingId,
            summaryVersionId: summary.id,
            text: item.text,
            evidenceSegmentIds: item.evidenceSegmentIds,
          })),
        });
      }
    });
    await db.processingStageAttempt.update({ where: { id: stageAttemptId }, data: { progressCurrent: 1, progressTotal: 1, progressMessage: "Outcomes saved" } });
    await publishProcessingUpdate(meetingId);
    return {
      summaryVersionId: summary.id,
      actionItemCount: content.actionItems.length,
      decisionCount: content.decisions.length,
      openQuestionCount: content.openQuestions.length,
    };
  });
  const completed = await db.summaryVersion.findFirstOrThrow({
    where: { meetingId, transcriptVersionId, status: "COMPLETED" },
    orderBy: { version: "desc" },
    select: { id: true },
  });
  return completed.id;
}
