"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ConfirmationDialog } from "@/app/confirmation-dialog";

export function UploadForm() {
  const router = useRouter();
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [file, setFile] = useState<File>();
  const [title, setTitle] = useState("");
  const [progress, setProgress] = useState(0);
  const [pendingNavigation, setPendingNavigation] = useState<string>();
  const xhr = useRef<XMLHttpRequest | null>(null);
  const submissionLocked = useRef(false);
  const today = new Date().toISOString().slice(0, 10);
  function choose(next?: File) { setFile(next); if (next && !title) setTitle(next.name.replace(/\.[^.]+$/, "").replaceAll(/[_-]+/g, " ").replaceAll(/\s+/g, " ").trim()); setStatus(""); }
  useEffect(() => { if (!busy) return; const unload = (event: BeforeUnloadEvent) => { event.preventDefault(); }; const navigate = (event: MouseEvent) => { const anchor = (event.target as Element).closest("a"); if (!anchor || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return; event.preventDefault(); setPendingNavigation(anchor.href); }; window.addEventListener("beforeunload", unload); document.addEventListener("click", navigate, true); return () => { window.removeEventListener("beforeunload", unload); document.removeEventListener("click", navigate, true); }; }, [busy]);
  return <><form className="upload-card" onSubmit={async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    if (!file || submissionLocked.current) return;
    submissionLocked.current = true;
    setBusy(true); setProgress(0); setStatus("Uploading to private storage…");
    try {
      const body = await new Promise<{ meetingId?: string; error?: string }>((resolve, reject) => { const request = new XMLHttpRequest(); xhr.current = request; request.open("POST", "/api/meetings/upload"); request.setRequestHeader("x-filename", encodeURIComponent(file.name)); request.setRequestHeader("x-meeting-title", encodeURIComponent(String(form.get("title") || file.name))); request.setRequestHeader("x-recording-date", String(form.get("recordingDate") || "")); request.upload.onprogress = (e) => { if (e.lengthComputable) setProgress(Math.round((e.loaded / e.total) * 100)); }; request.onerror = () => reject(new Error("Connection lost during upload")); request.onabort = () => reject(new Error("Upload cancelled")); request.onload = () => { let value: { meetingId?: string; error?: string } = {}; try { value = JSON.parse(request.responseText || "{}"); } catch { /* invalid response */ } if (request.status >= 200 && request.status < 300) resolve(value); else reject(new Error(value.error ?? "Upload failed")); }; request.send(file); });
      if (!body.meetingId) throw new Error("Upload completed without a meeting ID");
      setStatus("Upload complete. Opening meeting…"); setProgress(100); router.push(`/meetings/${body.meetingId}`);
    } catch (error) { submissionLocked.current = false; setStatus(error instanceof Error ? error.message : "Upload failed"); setBusy(false); }
  }} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); if (!busy) choose(event.dataTransfer.files[0]); }}>
    <div className="workflow-switch" role="tablist" aria-label="Meeting source"><button type="button" role="tab" aria-selected="true">Upload file</button><button type="button" role="tab" aria-selected="false" disabled title="Browser recording is not connected yet">Record live <small>Coming soon</small></button></div>
    <div className="upload-step"><span>1</span><div><h2>Choose recording</h2><p>Audio and MP4/WebM video supported. Large files and meetings over 30 minutes are accepted by the streaming upload.</p></div></div>
    <label className="file-drop"><input name="file" type="file" accept="audio/*,video/mp4,video/webm" required onChange={(event) => choose(event.target.files?.[0])}/><strong>{file ? "Change recording" : "Choose a recording"}</strong><span>{file ? `${file.name} · ${formatBytes(file.size)} · ${file.type || "Unknown type"}` : "Tap to browse or drop a file here"}</span></label>
    <div className="form-grid"><label>Meeting title<input name="title" maxLength={200} required value={title} onChange={(event) => setTitle(event.target.value)} /></label><label>Meeting date<input name="recordingDate" type="date" defaultValue={today} required /></label></div>
    <details className="upload-options"><summary>Local processing settings</summary><div className="form-grid"><label>Language<select disabled aria-describedby="processing-defaults"><option>Automatic detection</option></select></label><label>Transcription model<select disabled aria-describedby="processing-defaults"><option>Local worker default</option></select></label><label>Speaker differentiation<select disabled aria-describedby="processing-defaults"><option>Enabled by local pipeline</option></select></label><label>Summary and outcomes<select disabled aria-describedby="processing-defaults"><option>Enabled by local pipeline</option></select></label></div><p id="processing-defaults"><small>Current backend uses worker-level defaults. Per-meeting overrides need a processing contract update.</small></p></details>
    <p className="privacy-strip"><span aria-hidden="true">⌂</span><span><strong>Processed on your system</strong><br/>Audio and meeting content remain on your local system.</span></p>
    {busy && <div className="progress-block"><div><span>{status}</span><strong>{progress}%</strong></div><progress max="100" value={progress}/></div>}
    <div className="form-actions"><button className="button primary" disabled={busy || !file}>{busy ? "Uploading…" : "Start upload"}</button>{busy && <button className="button secondary" type="button" onClick={() => xhr.current?.abort()}>Cancel upload</button>}<Link className="button tertiary" href="/">Back</Link></div><p role="status" className={status.includes("failed") || status.includes("lost") ? "form-error" : "form-status"}>{status}</p>
  </form><ConfirmationDialog open={Boolean(pendingNavigation)} title="Cancel upload and leave?" description="Upload is still in progress. Leaving now will cancel it, and this recording will not be processed." confirmLabel="Cancel upload and leave" danger onCancel={() => setPendingNavigation(undefined)} onConfirm={() => { const href = pendingNavigation; setPendingNavigation(undefined); xhr.current?.abort(); if (href) { const target = new URL(href); router.push(`${target.pathname}${target.search}${target.hash}`); } }}/></>;
}

function formatBytes(bytes: number) { return bytes < 1_048_576 ? `${(bytes / 1024).toFixed(0)} KB` : `${(bytes / 1_048_576).toFixed(1)} MB`; }
