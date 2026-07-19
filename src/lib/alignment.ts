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
  const assignments = words.map((word, index) => {
    if (word.endMs <= word.startMs || (index > 0 && word.startMs < words[index - 1].startMs)) {
      throw new Error("Whisper words must have monotonic positive timing");
    }
    return scoreWord(word, turns, minimumOverlap);
  });
  smoothBriefSpeakerChanges(words, assignments);
  const groups: Array<Array<{ word: WhisperWord; assignment: WordAssignment }>> = [];
  for (const [index, word] of words.entries()) {
    const assignment = assignments[index];
    const current = groups.at(-1);
    const previous = current?.at(-1);
    const startsNewPhrase = !current
      || !previous
      || Boolean(previous.assignment.speaker && assignment.speaker && previous.assignment.speaker !== assignment.speaker)
      || previous.word.sourceSegmentId !== word.sourceSegmentId
      || word.startMs - previous.word.endMs > 1_000
      || word.endMs - current[0].word.startMs > 12_000
      || /[.!?]["')\]]?\s*$/.test(previous.word.text);
    if (startsNewPhrase) groups.push([{ word, assignment }]);
    else current.push({ word, assignment });
  }
  return groups.map((group, ordinal) => {
    const speakerEvidence = new Map<string, number>();
    const speechDuration = group.reduce((total, item) => total + Math.max(1, item.word.endMs - item.word.startMs), 0);
    for (const item of group) if (item.assignment.speaker) {
      const duration = Math.max(1, item.word.endMs - item.word.startMs);
      speakerEvidence.set(item.assignment.speaker, (speakerEvidence.get(item.assignment.speaker) ?? 0) + duration * item.assignment.confidence);
    }
    const ranked = [...speakerEvidence.entries()].sort((left, right) => right[1] - left[1]);
    const best = ranked[0];
    const runnerUpOverlap = ranked[1]?.[1] ?? 0;
    const assignmentConfidence = best ? Math.min(1, best[1] / speechDuration) : 0;
    const hasClearWinner = best ? (best[1] - runnerUpOverlap) / speechDuration >= 0.15 : false;
    const speakerKey = assignmentConfidence >= minimumOverlap && hasClearWinner ? best?.[0] : undefined;
    const probabilities = group.flatMap(({ word }) => word.confidence === undefined ? [] : [word.confidence]);
    return {
      ordinal,
      startMs: BigInt(Math.round(group[0].word.startMs)),
      endMs: BigInt(Math.round(group.at(-1)?.word.endMs ?? group[0].word.endMs)),
      text: group.map(({ word }) => word.text).join("").trim(),
      speakerKey,
      assignmentConfidence,
      assignmentReason: speakerKey ? reason : "uncertain" as const,
      confidence: probabilities.length ? probabilities.reduce((sum, p) => sum + p, 0) / probabilities.length : undefined,
      sourceSegmentIds: [...new Set(group.map(({ word }) => word.sourceSegmentId))],
    };
  }).filter((segment) => segment.text.length > 0);
}

type DiarizationTurn = z.infer<typeof turnSchema>;
type WordAssignment = { speaker?: string; confidence: number };

function scoreWord(word: WhisperWord, turns: DiarizationTurn[], minimumOverlap: number): WordAssignment {
  const duration = Math.max(1, word.endMs - word.startMs);
  const overlapBySpeaker = new Map<string, number>();
  for (const turn of turns) {
    const overlap = Math.max(0, Math.min(word.endMs, turn.end * 1000) - Math.max(word.startMs, turn.start * 1000));
    if (overlap > 0) overlapBySpeaker.set(turn.speaker, (overlapBySpeaker.get(turn.speaker) ?? 0) + overlap);
  }
  const ranked = [...overlapBySpeaker.entries()].sort((left, right) => right[1] - left[1]);
  const best = ranked[0];
  if (best) {
    const confidence = Math.min(1, best[1] / duration);
    const margin = (best[1] - (ranked[1]?.[1] ?? 0)) / duration;
    return confidence >= minimumOverlap && margin >= 0.15 ? { speaker: best[0], confidence } : { confidence };
  }
  const nearest = turns.map((turn) => ({
    speaker: turn.speaker,
    distance: word.endMs <= turn.start * 1000
      ? turn.start * 1000 - word.endMs
      : word.startMs >= turn.end * 1000 ? word.startMs - turn.end * 1000 : 0,
  })).sort((left, right) => left.distance - right.distance);
  const candidate = nearest[0];
  const competitor = nearest.find((item) => item.speaker !== candidate?.speaker);
  if (candidate && candidate.distance <= 250 && (!competitor || competitor.distance - candidate.distance >= 100)) {
    return { speaker: candidate.speaker, confidence: minimumOverlap };
  }
  return { confidence: 0 };
}

function smoothBriefSpeakerChanges(words: WhisperWord[], assignments: WordAssignment[]): void {
  let start = 0;
  while (start < assignments.length) {
    const speaker = assignments[start].speaker;
    let end = start + 1;
    while (end < assignments.length && assignments[end].speaker === speaker) end += 1;
    if (speaker && end - start === 1 && words[start].endMs - words[start].startMs < 400) {
      const previous = assignments[start - 1]?.speaker;
      const next = assignments[end]?.speaker;
      if (previous && previous === next) assignments[start] = { ...assignments[start], speaker: previous };
      else assignments[start] = { confidence: assignments[start].confidence };
    }
    start = end;
  }
}
