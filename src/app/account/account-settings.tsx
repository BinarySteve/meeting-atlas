"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  PASSWORD_INPUT_MAX_LENGTH,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
} from "@/lib/password-policy";
import { securityEventLabel } from "@/lib/security-events";

type Profile = {
  name: string;
  email: string;
  passwordChangedAt: string | null;
};
type AccountSession = {
  id: string;
  authMethod: string;
  deviceLabel: string | null;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  current: boolean;
};
type SecurityEvent = { id: string; action: string; createdAt: string };

export function AccountSettings({
  initialProfile,
  initialSessions,
  securityEvents,
}: {
  initialProfile: Profile;
  initialSessions: AccountSession[];
  securityEvents: SecurityEvent[];
}) {
  const router = useRouter();
  const [profile, setProfile] = useState(initialProfile);
  const [sessions, setSessions] = useState(initialSessions);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState("");

  async function refreshSessions() {
    const response = await fetch("/api/account/sessions", {
      cache: "no-store",
    });
    if (response.ok)
      setSessions(
        ((await response.json()) as { sessions: AccountSession[] }).sessions,
      );
  }
  async function submitProfile(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy("profile");
    setMessage("");
    const form = event.currentTarget;
    const data = new FormData(form);
    const response = await fetch("/api/account/profile", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: data.get("name"),
        email: data.get("email"),
        currentPassword: data.get("currentPassword") || undefined,
      }),
    });
    const result = (await response.json()) as {
      error?: string;
      profile?: Pick<Profile, "name" | "email">;
    };
    if (response.ok && result.profile) {
      setProfile((value) => ({ ...value, ...result.profile }));
      window.dispatchEvent(
        new CustomEvent("profile-updated", {
          detail: { name: result.profile.name },
        }),
      );
      const passwordInput = form.elements.namedItem("currentPassword");
      if (passwordInput instanceof HTMLInputElement) passwordInput.value = "";
      setMessage("Profile updated.");
      router.refresh();
    } else setMessage(result.error ?? "Unable to update profile.");
    setBusy("");
  }
  async function submitPassword(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    const data = new FormData(event.currentTarget);
    const currentPassword = String(data.get("currentPassword") ?? "");
    const newPassword = String(data.get("newPassword") ?? "");
    if (newPassword !== String(data.get("confirmPassword") ?? "")) {
      setMessage("New password confirmation does not match.");
      return;
    }
    setBusy("password");
    const response = await fetch("/api/account/password", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    const result = (await response.json()) as {
      error?: string;
      reauthenticate?: boolean;
    };
    if (response.ok && result.reauthenticate) {
      router.replace("/login");
      router.refresh();
      return;
    }
    setMessage(result.error ?? "Unable to change password.");
    setBusy("");
  }
  async function revokeSession(id?: string) {
    setBusy(id ?? "sessions");
    setMessage("");
    const response = await fetch(
      id ? `/api/account/sessions/${id}` : "/api/account/sessions",
      { method: id ? "DELETE" : "POST" },
    );
    const result = (await response.json()) as {
      error?: string;
      count?: number;
    };
    if (response.ok) {
      await refreshSessions();
      setMessage(
        id
          ? "Session revoked."
          : `${result.count ?? 0} other sessions revoked.`,
      );
      router.refresh();
    } else setMessage(result.error ?? "Unable to revoke session.");
    setBusy("");
  }

  return (
    <>
      <section className="account-settings-grid">
        <article className="security-card account-form-card">
          <div>
            <p className="eyebrow">Identity</p>
            <h2>Profile & login</h2>
            <p>Your display name appears only inside this private workspace.</p>
          </div>
          <form onSubmit={(event) => void submitProfile(event)}>
            <label>
              Display name
              <input
                name="name"
                defaultValue={profile.name}
                maxLength={80}
                autoComplete="name"
                required
              />
            </label>
            <label>
              Login email
              <input
                name="email"
                type="email"
                defaultValue={profile.email}
                maxLength={254}
                autoComplete="username"
                required
              />
            </label>
            <label>
              Current password{" "}
              <small>Required only when changing login email.</small>
              <input
                name="currentPassword"
                type="password"
                maxLength={PASSWORD_INPUT_MAX_LENGTH}
                autoComplete="current-password"
              />
            </label>
            <button className="button primary" disabled={Boolean(busy)}>
              {busy === "profile" ? "Saving…" : "Save profile"}
            </button>
          </form>
        </article>
        <article className="security-card account-form-card">
          <div>
            <p className="eyebrow">Recovery credential</p>
            <h2>Change password</h2>
            <p>
              Use a unique passphrase or password-manager value. No composition
              rules.
            </p>
          </div>
          <form onSubmit={(event) => void submitPassword(event)}>
            <label>
              Current password
              <input
                name="currentPassword"
                type="password"
                maxLength={PASSWORD_INPUT_MAX_LENGTH}
                autoComplete="current-password"
                required
              />
            </label>
            <label>
              New password
              <input
                name="newPassword"
                type="password"
                minLength={PASSWORD_MIN_LENGTH}
                maxLength={PASSWORD_INPUT_MAX_LENGTH}
                autoComplete="new-password"
                required
              />
              <small>
                {PASSWORD_MIN_LENGTH}–{PASSWORD_MAX_LENGTH} characters; spaces
                and Unicode allowed.
              </small>
            </label>
            <label>
              Confirm new password
              <input
                name="confirmPassword"
                type="password"
                minLength={PASSWORD_MIN_LENGTH}
                maxLength={PASSWORD_INPUT_MAX_LENGTH}
                autoComplete="new-password"
                required
              />
            </label>
            <button className="button primary" disabled={Boolean(busy)}>
              {busy === "password" ? "Changing…" : "Change password"}
            </button>
            {profile.passwordChangedAt && (
              <small>
                Last changed {formatDateTime(profile.passwordChangedAt)}
              </small>
            )}
          </form>
        </article>
        <article className="security-card session-card">
          <div className="account-card-heading">
            <div>
              <p className="eyebrow">Access</p>
              <h2>Active sessions</h2>
              <p>Sessions expire after 2 hours idle or 12 hours total.</p>
            </div>
            {sessions.length > 1 && (
              <button
                className="button secondary"
                disabled={Boolean(busy)}
                onClick={() => void revokeSession()}
              >
                {busy === "sessions" ? "Revoking…" : "Revoke other sessions"}
              </button>
            )}
          </div>
          <div className="session-list">
            {sessions.map((session) => (
              <div className="session-row" key={session.id}>
                <span
                  className={`session-marker ${session.current ? "current" : ""}`}
                  aria-hidden="true"
                />
                <div>
                  <strong>
                    {session.deviceLabel ?? "Unknown browser"}
                    {session.current && (
                      <span className="current-session">Current</span>
                    )}
                  </strong>
                  <small>
                    {humanize(session.authMethod)} · Last active{" "}
                    {formatDateTime(session.lastSeenAt)}
                  </small>
                  <small>
                    Started {formatDateTime(session.createdAt)} · Expires{" "}
                    {formatDateTime(session.expiresAt)}
                  </small>
                </div>
                {!session.current && (
                  <button
                    className="button revoke-button"
                    disabled={Boolean(busy)}
                    onClick={() => void revokeSession(session.id)}
                  >
                    {busy === session.id ? "Revoking…" : "Revoke"}
                  </button>
                )}
              </div>
            ))}
          </div>
        </article>
        <article className="security-card security-history">
          <div>
            <p className="eyebrow">Audit trail</p>
            <h2>Recent security activity</h2>
            <p>
              Successful account changes only; no passwords, IP addresses, or
              private meeting data.
            </p>
          </div>
          {securityEvents.length ? (
            <ol>
              {securityEvents.map((event) => (
                <li key={event.id}>
                  <span />
                  <div>
                    <strong>{securityEventLabel(event.action)}</strong>
                    <time>{formatDateTime(event.createdAt)}</time>
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <p className="empty">No security changes recorded yet.</p>
          )}
        </article>
      </section>
      <p className="form-status account-page-status" role="status">
        {message}
      </p>
    </>
  );
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
function humanize(value: string) {
  return value.toLocaleLowerCase().replaceAll("_", " ");
}
