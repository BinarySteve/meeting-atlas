"use client";

import type { JobState } from "@prisma/client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

export function JobControls({ jobId, state }: { jobId: string; state: JobState }) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const running = ["QUEUED", "ACTIVE", "RETRYING", "CANCEL_REQUESTED"].includes(state);
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => router.refresh(), 3_000);
    return () => window.clearInterval(timer);
  }, [router, running]);
  async function act(action: "retry" | "cancel") {
    setMessage(`${action === "retry" ? "Retrying" : "Cancelling"}…`);
    const response = await fetch(`/api/jobs/${jobId}/${action}`, { method: "POST" });
    const body = await response.json() as { error?: string };
    setMessage(response.ok ? "Request accepted" : body.error ?? "Request failed");
    router.refresh();
  }
  if (state === "COMPLETED") return null;
  return <div className="job-controls">{!running && <button onClick={() => void act("retry")}>Retry incomplete stages</button>}{running && <button disabled={state === "CANCEL_REQUESTED"} onClick={() => void act("cancel")}>Cancel</button>}<span role="status">{message}</span></div>;
}
