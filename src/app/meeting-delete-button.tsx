"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ConfirmationDialog } from "@/app/confirmation-dialog";

export function MeetingDeleteButton({ meetingId, meetingTitle, className = "" }: { meetingId: string; meetingTitle: string; className?: string }) {
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState(false);

  async function deleteMeeting() {
    setDeleting(true);
    setError("");
    try {
      const response = await fetch(`/api/meetings/${meetingId}`, { method: "DELETE" });
      const result = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) {
        setError(result?.error ?? "Delete failed");
        return;
      }
      setConfirming(false);
      router.push("/");
      router.refresh();
    } catch {
      setError("Delete failed. Check the local server and try again.");
    } finally {
      setDeleting(false);
    }
  }

  return <div className={`meeting-delete-control ${className}`.trim()}>
    <button type="button" className="danger" disabled={deleting} onClick={() => setConfirming(true)}>{deleting ? "Deleting…" : "Delete meeting"}</button>
    {error && <p className="form-error" role="alert">{error}</p>}
    <ConfirmationDialog open={confirming} title="Delete meeting permanently?" description={`“${meetingTitle}” and all its recordings, transcripts, summaries, and exports will be permanently deleted. This cannot be undone.`} confirmLabel="Delete meeting" danger busy={deleting} onCancel={() => setConfirming(false)} onConfirm={() => void deleteMeeting()}/>
  </div>;
}
