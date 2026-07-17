"use client";

import {
  browserSupportsWebAuthn,
  startAuthentication,
} from "@simplewebauthn/browser";
import type { PublicKeyCredentialRequestOptionsJSON } from "@simplewebauthn/server";
import { useRouter } from "next/navigation";
import { useState, useSyncExternalStore } from "react";
import { APP_NAME } from "@/lib/brand";
import { PASSWORD_INPUT_MAX_LENGTH } from "@/lib/password-policy";
import { BrandGlyph } from "../brand-glyph";

export default function Login() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const supportsPasskeys = useSyncExternalStore(
    subscribeBrowserCapability,
    browserSupportsWebAuthn,
    () => false,
  );

  async function signInWithPasskey() {
    setBusy(true);
    setError("");
    try {
      const optionResponse = await fetch(
        "/api/auth/passkeys/authentication/options",
        { method: "POST" },
      );
      if (!optionResponse.ok) throw new Error("Passkey sign-in unavailable");
      const optionsJSON =
        (await optionResponse.json()) as PublicKeyCredentialRequestOptionsJSON;
      const assertion = await startAuthentication({ optionsJSON });
      const response = await fetch("/api/auth/passkeys/authentication/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(assertion),
      });
      if (!response.ok)
        throw new Error("Passkey not recognized. Try password recovery.");
      router.replace("/");
      router.refresh();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Passkey sign-in failed",
      );
      setBusy(false);
    }
  }

  async function signInWithPassword(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const data = new FormData(event.currentTarget);
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: data.get("email"),
        password: data.get("password"),
      }),
    });
    const body = (await response.json()) as { suggestPasskey?: boolean };
    if (response.ok) {
      router.replace(body.suggestPasskey ? "/account?setup=passkey" : "/");
      router.refresh();
    } else {
      setError("Invalid credentials");
      setBusy(false);
    }
  }

  return (
    <main className="login-page">
      <section className="login-card">
        <div className="login-brand">
          <span className="brand-mark">
            <BrandGlyph />
          </span>
          <span>{APP_NAME}</span>
        </div>
        <header>
          <p className="eyebrow">PRIVATE HOMELAB</p>
          <h1>Welcome back</h1>
          <p>Unlock your private meeting workspace.</p>
        </header>
        {supportsPasskeys && (
          <button
            className="button primary passkey-button"
            disabled={busy}
            onClick={() => void signInWithPasskey()}
          >
            <span aria-hidden="true">⌁</span>
            {busy ? "Waiting for passkey…" : "Sign in with a passkey"}
          </button>
        )}
        <details className="password-recovery" open={!supportsPasskeys}>
          <summary>
            {supportsPasskeys
              ? "Use password recovery"
              : "Sign in with password"}
          </summary>
          <form onSubmit={(event) => void signInWithPassword(event)}>
            <label>
              Email
              <input
                name="email"
                type="email"
                autoComplete="username"
                required
              />
            </label>
            <label>
              Password
              <input
                name="password"
                type="password"
                autoComplete="current-password"
                maxLength={PASSWORD_INPUT_MAX_LENGTH}
                required
              />
            </label>
            <button className="button secondary" disabled={busy}>
              Sign in with password
            </button>
          </form>
        </details>
        <p role="alert" className="form-error">
          {error}
        </p>
        <p className="privacy-note">
          Authentication and recordings stay on your local server.
        </p>
      </section>
    </main>
  );
}

function subscribeBrowserCapability() {
  return () => undefined;
}
