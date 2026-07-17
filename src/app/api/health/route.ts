import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { redis } from "@/lib/redis";
import { spawn } from "node:child_process";
import { getEnv } from "@/lib/env";

export async function GET() {
  const checks: Record<string, { status: "healthy" | "degraded" | "unavailable"; detail?: string }> = {};
  try { await db.$queryRaw`SELECT 1`; checks.database = { status: "healthy" }; } catch (e) { checks.database = { status: "unavailable", detail: e instanceof Error ? e.message : "failed" }; }
  try {
    if (redis.status === "wait") await redis.connect();
    checks.redis = (await redis.ping()) === "PONG" ? { status: "healthy" } : { status: "unavailable" };
    const heartbeat = await redis.get("health:worker");
    checks.worker = heartbeat && Date.now() - new Date(heartbeat).getTime() < 30_000 ? { status: "healthy" } : { status: "unavailable", detail: "No recent worker heartbeat" };
  } catch (e) { checks.redis = { status: "unavailable", detail: safeMessage(e) }; checks.worker = { status: "unavailable", detail: "Redis unavailable" }; }
  const env = getEnv();
  checks.ffmpeg = await commandHealth(env.FFMPEG_PATH);
  checks.ffprobe = await commandHealth(env.FFPROBE_PATH);
  checks.lmStudio = await httpHealth(`${env.LM_STUDIO_URL}/models`);
  checks.processingService = env.PROCESSING_MODE === "simulation" ? { status: "degraded", detail: "Development simulation mode" } : await httpHealth(`${env.PROCESSING_API_URL}/health`, { authorization: `Bearer ${env.PROCESSING_API_CREDENTIAL}` });
  const required = [checks.database, checks.redis, checks.worker, checks.ffmpeg, checks.ffprobe];
  const status = required.some((check) => check.status === "unavailable") ? "unavailable" : Object.values(checks).every((check) => check.status === "healthy") ? "healthy" : "degraded";
  return NextResponse.json({ status, checks }, { status: status === "unavailable" ? 503 : 200 });
}

function safeMessage(error: unknown): string { return error instanceof Error ? error.message.slice(0, 300) : "failed"; }

async function commandHealth(command: string): Promise<{ status: "healthy" | "unavailable"; detail?: string }> {
  return new Promise((resolve) => {
    const child = spawn(command, ["-version"], { shell: false, windowsHide: true, stdio: "ignore" });
    const timer = setTimeout(() => { child.kill(); resolve({ status: "unavailable", detail: "Timed out" }); }, getEnv().HEALTH_TIMEOUT_MS);
    child.on("error", (error) => { clearTimeout(timer); resolve({ status: "unavailable", detail: safeMessage(error) }); });
    child.on("close", (code) => { clearTimeout(timer); resolve(code === 0 ? { status: "healthy" } : { status: "unavailable", detail: `Exited ${code}` }); });
  });
}

async function httpHealth(url: string, headers?: HeadersInit): Promise<{ status: "healthy" | "unavailable"; detail?: string }> {
  try { const response = await fetch(url, { headers, signal: AbortSignal.timeout(getEnv().HEALTH_TIMEOUT_MS), cache: "no-store" }); return response.ok ? { status: "healthy" } : { status: "unavailable", detail: `HTTP ${response.status}` }; }
  catch (error) { return { status: "unavailable", detail: safeMessage(error) }; }
}
