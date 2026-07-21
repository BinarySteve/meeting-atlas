import { spawn } from "node:child_process";
import { z } from "zod";
import { getEnv } from "./env";

const probeSchema = z.object({
  format: z.object({ format_name: z.string(), duration: z.string(), size: z.string() }),
  streams: z.array(z.object({ codec_type: z.string(), sample_rate: z.string().optional(), channels: z.number().optional() }).passthrough()),
}).passthrough();
export type MediaInfo = { format: string; durationMs: bigint; byteSize: bigint; sampleRate?: number; channels?: number; raw: z.infer<typeof probeSchema> };

async function run(command: string, args: readonly string[], timeoutMs: number, signal?: AbortSignal): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { shell: false, windowsHide: true });
    let stdout = ""; let stderr = "";
    const timer = setTimeout(() => { child.kill(); reject(new Error(`${command} timed out`)); }, timeoutMs);
    const cancel = () => { child.kill(); reject(new Error("JOB_CANCELLED")); };
    if (signal?.aborted) cancel(); else signal?.addEventListener("abort", cancel, { once: true });
    child.stdout.on("data", (data: Buffer) => { stdout += data.toString(); });
    child.stderr.on("data", (data: Buffer) => { stderr = (stderr + data.toString()).slice(-16_384); });
    child.on("error", reject);
    child.on("close", (code) => { clearTimeout(timer); signal?.removeEventListener("abort", cancel); if (code === 0) resolve({ stdout, stderr }); else reject(new Error(`${command} failed (${code}): ${stderr}`)); });
  });
}

export async function inspectMedia(filePath: string, signal?: AbortSignal): Promise<MediaInfo> {
  const { stdout } = await run(getEnv().FFPROBE_PATH, ["-v", "error", "-show_format", "-show_streams", "-of", "json", filePath], 120_000, signal);
  const raw = probeSchema.parse(JSON.parse(stdout));
  const audio = raw.streams.find((stream) => stream.codec_type === "audio");
  if (!audio) throw new Error("Uploaded media contains no audio stream");
  return { format: raw.format.format_name, durationMs: BigInt(Math.round(Number(raw.format.duration) * 1000)), byteSize: BigInt(raw.format.size), sampleRate: audio.sample_rate ? Number(audio.sample_rate) : undefined, channels: audio.channels, raw };
}

export async function normalizeMedia(input: string, output: string, signal?: AbortSignal): Promise<MediaInfo> {
  await run(getEnv().FFMPEG_PATH, ["-nostdin", "-y", "-i", input, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", output], getEnv().SUBPROCESS_TIMEOUT_MS, signal);
  return inspectMedia(output, signal);
}
