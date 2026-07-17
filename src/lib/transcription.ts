import { z } from "zod";

const tokenSchema = z.object({
  text: z.string(),
  offsets: z.object({ from: z.number(), to: z.number() }),
  p: z.number().min(0).max(1).optional(),
}).passthrough();

const segmentSchema = z.object({
  offsets: z.object({ from: z.number().nonnegative(), to: z.number().nonnegative() }),
  text: z.string(),
  tokens: z.array(tokenSchema).default([]),
}).passthrough();

const responseSchema = z.object({
  raw: z.object({ transcription: z.array(segmentSchema) }).passthrough(),
}).passthrough();

const SPECIAL_TOKEN = /\[_[A-Z0-9_]+\]/g;
const SPECIAL_TOKEN_ONLY = /^\[_[A-Z0-9_]+\]$/;

export type AssembledMachineSegment = {
  ordinal: number;
  startMs: bigint;
  endMs: bigint;
  text: string;
  confidence?: number;
  sourceSegmentIds: string[];
};

export type WhisperWord = { text: string; startMs: number; endMs: number; confidence?: number; sourceSegmentId: string };

export function extractWhisperWords(value: unknown): WhisperWord[] {
  const parsed = responseSchema.parse(value);
  return parsed.raw.transcription.flatMap((segment, segmentIndex) => segment.tokens.flatMap((token) => {
    if (SPECIAL_TOKEN_ONLY.test(token.text) || !token.text) return [];
    return [{ text: token.text, startMs: token.offsets.from, endMs: token.offsets.to, confidence: token.p, sourceSegmentId: `whisper:${segmentIndex}` }];
  }));
}

export function assembleWhisperCppResponse(value: unknown): AssembledMachineSegment[] {
  const parsed = responseSchema.parse(value);
  return parsed.raw.transcription.flatMap((segment, ordinal) => {
    const text = segment.text.replace(SPECIAL_TOKEN, "").trim();
    if (!text || segment.offsets.to <= segment.offsets.from) return [];
    const probabilities = segment.tokens
      .filter((token) => !SPECIAL_TOKEN_ONLY.test(token.text) && token.p !== undefined)
      .map((token) => token.p as number);
    return [{
      ordinal,
      startMs: BigInt(Math.round(segment.offsets.from)),
      endMs: BigInt(Math.round(segment.offsets.to)),
      text,
      confidence: probabilities.length ? probabilities.reduce((sum, p) => sum + p, 0) / probabilities.length : undefined,
      sourceSegmentIds: [`whisper:${ordinal}`],
    }];
  });
}
