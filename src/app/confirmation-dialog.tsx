"use client";

import { useEffect, useRef } from "react";

export function ConfirmationDialog({
  open,
  title,
  description,
  confirmLabel = "Confirm",
  busy = false,
  danger = false,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  busy?: boolean;
  danger?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const node = dialog.current;
    if (!node) return;
    if (open && !node.open) node.showModal();
    if (!open && node.open) node.close();
  }, [open]);

  return <dialog ref={dialog} className="confirmation-dialog" onCancel={(event) => { event.preventDefault(); if (!busy) onCancel(); }} onClose={() => { if (open && !busy) onCancel(); }}>
    <div className="confirmation-dialog-copy">
      <h2>{title}</h2>
      <p>{description}</p>
    </div>
    <div className="confirmation-dialog-actions">
      <button type="button" className="button secondary" disabled={busy} onClick={onCancel}>Cancel</button>
      <button type="button" className={danger ? "button danger danger-fill" : "button primary"} disabled={busy} onClick={onConfirm} autoFocus>{busy ? "Working…" : confirmLabel}</button>
    </div>
  </dialog>;
}
