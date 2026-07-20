import { createReadStream } from "node:fs";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import { z } from "zod";
import { getEnv } from "./env";

const processingResponse = z.record(z.string(), z.unknown());

export async function streamProcessingRequest(endpoint: "transcribe" | "diarize", filePath: string, signal?: AbortSignal, requestId?: string): Promise<Record<string, unknown>> {
  const env = getEnv();
  const url = new URL(`/v1/${endpoint}`, env.PROCESSING_API_URL);
  const transport = url.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const request = transport.request(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.PROCESSING_API_CREDENTIAL}`,
        "content-type": "application/octet-stream",
        "x-filename": path.basename(filePath),
        ...(requestId ? { "x-request-id": requestId } : {}),
      },
      timeout: env.SUBPROCESS_TIMEOUT_MS,
    }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk: string) => {
        body += chunk;
        if (body.length > 256 * 1024 * 1024) request.destroy(new Error("Processing response exceeded limit"));
      });
      response.on("end", () => {
        if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(`Processing service HTTP ${response.statusCode ?? "unknown"}: ${body.slice(0, 1000)}`));
          return;
        }
        try { resolve(processingResponse.parse(JSON.parse(body))); }
        catch (error) { reject(error); }
      });
    });
    request.on("timeout", () => request.destroy(new Error("Processing service timed out")));
    request.on("error", reject);
    const cancel = () => { request.destroy(new Error("JOB_CANCELLED")); if (requestId) void cancelRemoteRequest(env.PROCESSING_API_URL, env.PROCESSING_API_CREDENTIAL, requestId); };
    if (signal?.aborted) cancel(); else signal?.addEventListener("abort", cancel, { once: true });
    request.on("close", () => signal?.removeEventListener("abort", cancel));
    const input = createReadStream(filePath);
    input.on("error", reject);
    input.pipe(request);
  });
}

export async function processingJsonRequest(endpoint: "llm/structured", body: unknown, signal?: AbortSignal, requestId?: string): Promise<Record<string, unknown>> {
  const env = getEnv();
  const response = await fetch(new URL(`/v1/${endpoint}`, env.PROCESSING_API_URL), {
    method: "POST",
    headers: { authorization: `Bearer ${env.PROCESSING_API_CREDENTIAL}`, "content-type": "application/json", ...(requestId ? { "x-request-id": requestId } : {}) },
    body: JSON.stringify(body),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(env.SUBPROCESS_TIMEOUT_MS)]) : AbortSignal.timeout(env.SUBPROCESS_TIMEOUT_MS),
    cache: "no-store",
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Processing service HTTP ${response.status}: ${text.slice(0, 1000)}`);
  return processingResponse.parse(JSON.parse(text));
}

export async function processingHealthRequest(): Promise<Record<string, unknown>> {
  const env = getEnv();
  const response = await fetch(new URL("/health", env.PROCESSING_API_URL), {
    headers: { authorization: `Bearer ${env.PROCESSING_API_CREDENTIAL}` },
    signal: AbortSignal.timeout(env.HEALTH_TIMEOUT_MS),
    cache: "no-store",
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Processing health HTTP ${response.status}: ${text.slice(0, 1000)}`);
  return processingResponse.parse(JSON.parse(text));
}

async function cancelRemoteRequest(baseUrl: string, credential: string, requestId: string): Promise<void> {
  await fetch(new URL(`/v1/cancel/${encodeURIComponent(requestId)}`, baseUrl), { method: "POST", headers: { authorization: `Bearer ${credential}` }, signal: AbortSignal.timeout(3_000), cache: "no-store" }).catch(() => undefined);
}
