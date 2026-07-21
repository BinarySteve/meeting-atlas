import type { TranscriptSegment } from "@prisma/client";
import { z } from "zod";

const evidenceIds = z.array(z.string()).min(1);
const evidencedText = z.object({ text: z.string().min(1), evidenceSegmentIds: evidenceIds, confidence: z.number().min(0).max(1) });
const actionItem = z.object({ description: z.string().min(1), owner: z.string().nullable(), dueDate: z.string().date().nullable(), evidenceSegmentIds: evidenceIds, confidence: z.number().min(0).max(1) });
export const meetingOutputSchema = z.object({
  summary: z.string(),
  decisions: z.array(evidencedText),
  actionItems: z.array(actionItem),
  openQuestions: z.array(evidencedText.omit({ confidence: true })),
  importantClaims: z.array(evidencedText),
});
export type MeetingOutput = z.infer<typeof meetingOutputSchema>;

export type TranscriptSection = { ordinal: number; startMs: bigint; endMs: bigint; segmentIds: string[]; text: string };

export function sectionTranscript(segments: TranscriptSegment[], maxCharacters = 12_000): TranscriptSection[] {
  const sections: TranscriptSection[] = [];
  let current: TranscriptSegment[] = [];
  let length = 0;
  const flush = () => {
    if (!current.length) return;
    sections.push({ ordinal: sections.length, startMs: current[0].startMs, endMs: current.at(-1)?.endMs ?? current[0].endMs, segmentIds: current.map((segment) => segment.id), text: current.map((segment) => `[${segment.id}] ${formatTime(segment.startMs)} ${segment.text}`).join("\n") });
    current = []; length = 0;
  };
  for (const segment of segments.filter((item) => !item.excludedFromSummary)) {
    const lineLength = segment.id.length + segment.text.length + 20;
    if (current.length && length + lineLength > maxCharacters) flush();
    current.push(segment); length += lineLength;
  }
  flush();
  return sections;
}

export function validateEvidence(output: MeetingOutput, allowedIds: Set<string>): MeetingOutput {
  const collections = [output.decisions, output.actionItems, output.openQuestions, output.importantClaims];
  for (const collection of collections) for (const item of collection) for (const id of item.evidenceSegmentIds) if (!allowedIds.has(id)) throw new Error(`LLM referenced unknown evidence segment ${id}`);
  return output;
}

export function discardUnsupportedEvidence(output: MeetingOutput, allowedIds: Set<string>): MeetingOutput {
  const constrain = <T extends { evidenceSegmentIds: string[] }>(items: T[]): T[] => items.flatMap((item) => {
    const evidenceSegmentIds = item.evidenceSegmentIds.filter((id) => allowedIds.has(id));
    return evidenceSegmentIds.length ? [{ ...item, evidenceSegmentIds }] : [];
  });
  return {
    ...output,
    decisions: constrain(output.decisions),
    actionItems: constrain(output.actionItems),
    openQuestions: constrain(output.openQuestions),
    importantClaims: constrain(output.importantClaims),
  };
}

export const meetingOutputJsonSchema = z.toJSONSchema(meetingOutputSchema, { target: "draft-7" });

export const SECTION_SYSTEM_PROMPT = `You summarize one timestamped meeting transcript section. Use only explicit statements. Never invent attendees, identities, decisions, owners, deadlines, promises, concerns, or conclusions. If owner or due date is not explicit, use null. Every structured item must cite one or more exact segment IDs supplied in brackets. Return only schema-valid JSON.`;
export const FINAL_SYSTEM_PROMPT = `You synthesize section summaries into one meeting result. Use only supplied section outputs. Never invent facts or evidence. Preserve exact transcript evidence segment IDs. Deduplicate only when evidence supports same item. Unspecified owners and dates remain null. Return only schema-valid JSON.`;

function formatTime(value: bigint): string { const seconds = Math.floor(Number(value) / 1000); return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`; }
