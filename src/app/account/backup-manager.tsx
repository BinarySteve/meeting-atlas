"use client";

import { useEffect, useState } from "react";
import { ConfirmationDialog } from "@/app/confirmation-dialog";

type Backup = { name: string; createdAt: string; size: number };

export function BackupManager() {
  const [backups, setBackups] = useState<Backup[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<Backup>();

  useEffect(() => {
    let active = true;
    void fetch("/api/account/backups", { cache: "no-store" })
      .then(async (response) => ({ response, result: await response.json() as { backups?: Backup[]; error?: string } }))
      .then(({ response, result }) => {
        if (!active) return;
        if (response.ok) setBackups(result.backups ?? []);
        else setMessage(result.error ?? "Unable to load backups.");
        setLoading(false);
      })
      .catch(() => { if (active) { setMessage("Unable to load backups."); setLoading(false); } });
    return () => { active = false; };
  }, []);

  async function create() {
    setBusy("create");
    setMessage("Creating database and recording archive…");
    const response = await fetch("/api/account/backups", { method: "POST" });
    const result = await response.json() as { backup?: Backup; error?: string };
    if (response.ok && result.backup) {
      setBackups((current) => [result.backup!, ...current]);
      setMessage("Backup created. Verify it before copying off this disk.");
    } else setMessage(result.error ?? "Backup creation failed.");
    setBusy("");
  }

  async function verify(backup: Backup) {
    setBusy(`verify:${backup.name}`);
    setMessage(`Verifying ${backup.name}…`);
    const response = await fetch(`/api/account/backups/${encodeURIComponent(backup.name)}`, { method: "POST" });
    const result = await response.json() as { verification?: { files: number; bytes: number }; error?: string };
    setMessage(response.ok && result.verification ? `Verified ${result.verification.files} files (${formatBytes(result.verification.bytes)}).` : result.error ?? "Backup verification failed.");
    setBusy("");
  }

  async function remove() {
    if (!deleteTarget) return;
    setBusy(`delete:${deleteTarget.name}`);
    const response = await fetch(`/api/account/backups/${encodeURIComponent(deleteTarget.name)}`, { method: "DELETE" });
    const result = await response.json() as { error?: string };
    if (response.ok) {
      setBackups((current) => current.filter((backup) => backup.name !== deleteTarget.name));
      setMessage("Backup deleted.");
      setDeleteTarget(undefined);
    } else setMessage(result.error ?? "Backup could not be deleted.");
    setBusy("");
  }

  return <section className="security-card backup-manager">
    <div className="backup-heading">
      <div><p className="eyebrow">Recovery</p><h2>Backups</h2><p>Create a PostgreSQL dump and filesystem archive together. Archives stay in configured local backup folder.</p></div>
      <button type="button" className="button primary" disabled={Boolean(busy)} onClick={() => void create()}>{busy === "create" ? "Creating…" : "Create backup"}</button>
    </div>
    <p className="backup-note">Restores stay manual so browser can never overwrite live database. Copy verified archives to another physical disk for disk-failure protection.</p>
    {loading ? <p className="empty">Loading backups…</p> : backups.length ? <div className="backup-list">{backups.map((backup) => <article className="backup-row" key={backup.name}>
      <div><strong>{backup.name}</strong><small>{new Date(backup.createdAt).toLocaleString()} · {formatBytes(backup.size)}</small></div>
      <div className="backup-actions"><a className="button secondary" href={`/api/account/backups/${encodeURIComponent(backup.name)}`}>Download</a><button type="button" disabled={Boolean(busy)} onClick={() => void verify(backup)}>{busy === `verify:${backup.name}` ? "Verifying…" : "Verify"}</button><button type="button" className="danger" disabled={Boolean(busy)} onClick={() => setDeleteTarget(backup)}>Delete</button></div>
    </article>)}</div> : <div className="empty-state"><strong>No backups yet</strong><p>Create first recovery archive. Large recording libraries may take several minutes.</p></div>}
    <p className="form-status" role="status">{message}</p>
    <ConfirmationDialog open={Boolean(deleteTarget)} title="Delete backup archive?" description={`${deleteTarget?.name ?? "This archive"} will be permanently removed from local backup folder. This cannot be undone.`} confirmLabel="Delete backup" danger busy={busy.startsWith("delete:")} onCancel={() => setDeleteTarget(undefined)} onConfirm={() => void remove()}/>
  </section>;
}

function formatBytes(bytes: number) {
  if (bytes < 1_048_576) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1_073_741_824) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  return `${(bytes / 1_073_741_824).toFixed(2)} GB`;
}
