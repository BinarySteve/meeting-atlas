"use client";

import {
  browserSupportsWebAuthn,
  startRegistration,
} from "@simplewebauthn/browser";
import type { PublicKeyCredentialCreationOptionsJSON } from "@simplewebauthn/server";
import { useState, useSyncExternalStore } from "react";
import { APP_NAME } from "@/lib/brand";
import { PASSWORD_INPUT_MAX_LENGTH } from "@/lib/password-policy";

type Passkey = {
  id: string;
  name: string;
  deviceType: string;
  backedUp: boolean;
  createdAt: string;
  lastUsedAt: string | null;
};

function SecurityIcon({
  name,
}: {
  name: "key" | "device" | "install" | "shield";
}) {
  const paths = {
    key: (
      <>
        <circle cx="8" cy="12" r="4" />
        <path d="m11 9 8-5 2 2-2 2 1.5 1.5-2.5 2.5-2-2-3 2" />
      </>
    ),
    device: (
      <>
        <rect x="5" y="3" width="14" height="18" rx="2" />
        <path d="M9 17h6" />
      </>
    ),
    install: (
      <>
        <path d="M12 3v12m0 0 4-4m-4 4-4-4" />
        <path d="M4 17v3h16v-3" />
      </>
    ),
    shield: (
      <>
        <path d="M12 3 5 6v5c0 4.7 2.8 8.2 7 10 4.2-1.8 7-5.3 7-10V6l-7-3Z" />
        <path d="m9 12 2 2 4-4" />
      </>
    ),
  };
  return (
    <span className="security-icon">
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {paths[name]}
      </svg>
    </span>
  );
}

export function PasskeyManager({
  initialPasskeys,
}: {
  initialPasskeys: Passkey[];
}) {
  const [passkeys, setPasskeys] = useState(initialPasskeys);
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const supported = useSyncExternalStore(
    subscribeBrowserCapability,
    browserSupportsWebAuthn,
    () => false,
  );

  async function refresh() {
    const response = await fetch("/api/account/passkeys");
    if (response.ok)
      setPasskeys(
        (
          (await response.json()) as {
            passkeys: Array<
              Omit<Passkey, "createdAt" | "lastUsedAt"> & {
                createdAt: string;
                lastUsedAt: string | null;
              }
            >;
          }
        ).passkeys,
      );
  }
  async function register() {
    if (!name.trim()) {
      setMessage("Give this passkey a recognizable name.");
      return;
    }
    if (!currentPassword) {
      setMessage("Enter your current password to add a passkey.");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const optionsResponse = await fetch(
        "/api/auth/passkeys/registration/options",
        { method: "POST" },
      );
      const optionsJSON =
        (await optionsResponse.json()) as PublicKeyCredentialCreationOptionsJSON & {
          error?: string;
        };
      if (!optionsResponse.ok)
        throw new Error(optionsJSON.error ?? "Could not start registration");
      const response = await startRegistration({ optionsJSON });
      const verify = await fetch("/api/auth/passkeys/registration/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ response, name: name.trim(), currentPassword }),
      });
      const result = (await verify.json()) as { error?: string };
      if (!verify.ok) throw new Error(result.error ?? "Registration failed");
      setName("");
      setCurrentPassword("");
      setMessage(
        "Passkey registered. Other sessions were signed out for safety.",
      );
      await refresh();
    } catch (cause) {
      setMessage(
        cause instanceof Error ? cause.message : "Passkey registration failed",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="security-layout">
      <div className="security-main">
        <section className="security-card security-reauth">
          <SecurityIcon name="shield" />
          <div>
            <p className="eyebrow">Confirm identity</p>
            <h2>Unlock passkey changes</h2>
            <p>
              Current password is required to add or revoke a sign-in method.
            </p>
            <label>
              Current password
              <input
                type="password"
                value={currentPassword}
                maxLength={PASSWORD_INPUT_MAX_LENGTH}
                autoComplete="current-password"
                onChange={(event) => setCurrentPassword(event.target.value)}
              />
            </label>
          </div>
        </section>
        <section className="security-card passkey-setup">
          <header className="security-section-header">
            <SecurityIcon name="key" />
            <div>
              <p className="eyebrow">Passwordless sign-in</p>
              <h2>Add a passkey</h2>
              <p>
                Use Face ID, a fingerprint, device PIN, or a hardware security
                key.
              </p>
            </div>
          </header>
          {supported ? (
            <div className="register-passkey">
              <label>
                Device name
                <input
                  value={name}
                  maxLength={80}
                  placeholder="e.g. Kitchen iPad"
                  onChange={(event) => setName(event.target.value)}
                />
                <small>Choose a name you will recognize later.</small>
              </label>
              <button
                className="button primary"
                disabled={busy}
                onClick={() => void register()}
              >
                {busy ? "Waiting for device…" : "Register passkey"}
              </button>
            </div>
          ) : (
            <p className="notice warning">
              This browser cannot register passkeys. Open this page on a
              supported HTTPS device.
            </p>
          )}
        </section>

        <section className="registered-section">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Trusted access</p>
              <h2>Registered devices</h2>
              <p>
                {passkeys.length}{" "}
                {passkeys.length === 1 ? "passkey" : "passkeys"} can access this
                account.
              </p>
            </div>
          </div>
          {passkeys.length ? (
            <div className="passkey-list">
              {passkeys.map((key) => (
                <article className="passkey-card" key={key.id}>
                  <SecurityIcon name="device" />
                  <div className="passkey-identity">
                    <strong>{key.name}</strong>
                    <span>
                      {key.backedUp
                        ? "Synced passkey"
                        : key.deviceType === "singleDevice"
                          ? "Device-bound passkey"
                          : "Passkey"}
                    </span>
                  </div>
                  <dl>
                    <div>
                      <dt>Created</dt>
                      <dd>{formatDate(key.createdAt)}</dd>
                    </div>
                    <div>
                      <dt>Last used</dt>
                      <dd>
                        {key.lastUsedAt
                          ? formatDateTime(key.lastUsedAt)
                          : "Never"}
                      </dd>
                    </div>
                  </dl>
                  <button
                    className="button revoke-button"
                    onClick={async () => {
                      if (!currentPassword) {
                        setMessage(
                          "Enter your current password above before revoking a passkey.",
                        );
                        return;
                      }
                      if (
                        !window.confirm(
                          `${passkeys.length === 1 ? "This is your last passkey. Password recovery will remain available. " : ""}Revoke ${key.name}?`,
                        )
                      )
                        return;
                      const response = await fetch(
                        `/api/account/passkeys/${key.id}`,
                        {
                          method: "DELETE",
                          headers: { "content-type": "application/json" },
                          body: JSON.stringify({ currentPassword }),
                        },
                      );
                      const result = (await response.json()) as {
                        error?: string;
                      };
                      if (response.ok) {
                        setCurrentPassword("");
                        setMessage(
                          "Passkey revoked. Other sessions were signed out.",
                        );
                        await refresh();
                      } else
                        setMessage(result.error ?? "Could not revoke passkey.");
                    }}
                  >
                    Revoke
                  </button>
                </article>
              ))}
            </div>
          ) : (
            <div className="empty-state">
              <strong>No passkeys yet</strong>
              <p>Password recovery remains available.</p>
            </div>
          )}
        </section>
      </div>

      <aside className="security-aside">
        <section className="security-card install-help">
          <SecurityIcon name="install" />
          <div>
            <p className="eyebrow">App access</p>
            <h2>Install {APP_NAME}</h2>
            <p>
              Open {APP_NAME} like a dedicated app without changing where
              meeting data lives.
            </p>
            <ol>
              <li>Open your browser menu or Share sheet.</li>
              <li>
                Choose <strong>Install app</strong> or{" "}
                <strong>Add to Home Screen</strong>.
              </li>
            </ol>
          </div>
        </section>
        <section className="security-card privacy-help">
          <SecurityIcon name="shield" />
          <div>
            <p className="eyebrow">Private by design</p>
            <h2>Your data stays local</h2>
            <p>
              Passkeys verify access. Recordings, transcripts, and meeting
              insights remain on this system.
            </p>
          </div>
        </section>
      </aside>
      <p className="form-status account-status" role="status">
        {message}
      </p>
    </div>
  );
}

function subscribeBrowserCapability() {
  return () => undefined;
}
function formatDate(value: string) {
  return new Date(value).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}
function formatDateTime(value: string) {
  return new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  });
}
