import { z } from "zod";
import type { WhisperWord } from "./transcription";

const turnSchema = z.object({ start: z.number().nonnegative(), end: z.number().positive(), speaker: z.string().min(1) });
const diarizationSchema = z.object({ turns: z.array(turnSchema), exclusive_turns: z.array(turnSchema).default([]) }).passthrough();

export type AlignedSegment = {
  ordinal: number;
  startMs: bigint;
  endMs: bigint;
  text: string;
  speakerKey?: string;
  assignmentConfidence: number;
  assignmentReason: "exclusive_overlap" | "regular_overlap" | "uncertain";
  confidence?: number;
  sourceSegmentIds: string[];
};

export function parseDiarization(value: unknown) { return diarizationSchema.parse(value); }

export function alignWordsToSpeakers(words: WhisperWord[], rawDiarization: unknown, minimumOverlap = 0.5): AlignedSegment[] {
  const diarization = parseDiarization(rawDiarization);
  const turns = diarization.exclusive_turns.length ? diarization.exclusive_turns : diarization.turns;
  const reason = diarization.exclusive_turns.length ? "exclusive_overlap" as const : "regular_overlap" as const;
  const groups: WhisperWord[][] = [];
  for (const word of words) {
    const current = groups.at(-1);
    const previous = current?.at(-1);
    const startsNewPhrase = !current
      || !previous
      || previous.sourceSegmentId !== word.sourceSegmentId
      || word.startMs - previous.endMs > 1_000
      || word.endMs - current[0].startMs > 12_000
      || /[.!?]["')\]]?\s*$/.test(previous.text);
    if (startsNewPhrase) groups.push([word]);
    else current.push(word);
  }
  return groups.map((group, ordinal) => {
    const speakerOverlap = new Map<string, number>();
    const speechDuration = group.reduce((total, word) => total + Math.max(1, word.endMs - word.startMs), 0);
    for (const word of group) for (const turn of turns) {
      const overlap = Math.max(0, Math.min(word.endMs, turn.end * 1000) - Math.max(word.startMs, turn.start * 1000));
      if (overlap > 0) speakerOverlap.set(turn.speaker, (speakerOverlap.get(turn.speaker) ?? 0) + overlap);
    }
    const ranked = [...speakerOverlap.entries()].sort((left, right) => right[1] - left[1]);
    const best = ranked[0];
    const runnerUpOverlap = ranked[1]?.[1] ?? 0;
    const assignmentConfidence = best ? Math.min(1, best[1] / speechDuration) : 0;
    const hasClearWinner = best ? (best[1] - runnerUpOverlap) / speechDuration >= 0.15 : false;
    const speakerKey = assignmentConfidence >= minimumOverlap && hasClearWinner ? best?.[0] : undefined;
    const probabilities = group.flatMap((word) => word.confidence === undefined ? [] : [word.confidence]);
    return {
      ordinal,
      startMs: BigInt(Math.round(group[0].startMs)),
      endMs: BigInt(Math.round(group.at(-1)?.endMs ?? group[0].endMs)),
      text: group.map((word) => word.text).join("").trim(),
      speakerKey,
      assignmentConfidence,
      assignmentReason: speakerKey ? reason : "uncertain" as const,
      confidence: probabilities.length ? probabilities.reduce((sum, p) => sum + p, 0) / probabilities.length : undefined,
      sourceSegmentIds: [...new Set(group.map((word) => word.sourceSegmentId))],
    };
  }).filter((segment) => segment.text.length > 0);
}
