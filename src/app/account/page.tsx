import type { Metadata } from "next";
import { requireSession, SESSION_IDLE_SECONDS } from "@/lib/auth";
import { db } from "@/lib/db";
import { SECURITY_ACTIONS } from "@/lib/security-events";
import { AccountSettings } from "./account-settings";
import { PasskeyManager } from "./passkey-manager";

export const metadata: Metadata = { title: "Account security" };

export default async function AccountPage() {
  const current = await requireSession();
  const now = new Date();
  const user = await db.user.findUniqueOrThrow({
    where: { id: current.userId },
    select: {
      name: true,
      email: true,
      passwordChangedAt: true,
      passkeys: {
        select: {
          id: true,
          name: true,
          deviceType: true,
          backedUp: true,
          createdAt: true,
          lastUsedAt: true,
        },
        orderBy: { createdAt: "desc" },
      },
      sessions: {
        where: {
          revokedAt: null,
          expiresAt: { gt: now },
          lastSeenAt: {
            gt: new Date(now.getTime() - SESSION_IDLE_SECONDS * 1000),
          },
        },
        select: {
          id: true,
          authMethod: true,
          deviceLabel: true,
          createdAt: true,
          lastSeenAt: true,
          expiresAt: true,
        },
        orderBy: { lastSeenAt: "desc" },
      },
      auditEvents: {
        where: { action: { in: [...SECURITY_ACTIONS] } },
        select: { id: true, action: true, createdAt: true },
        orderBy: { createdAt: "desc" },
        take: 12,
      },
    },
  });
  return (
    <main className="page-shell account-page">
      <header className="page-intro account-header">
        <div>
          <p className="eyebrow">Account</p>
          <h1>{user.name?.trim() || "Owner"}</h1>
          <p>Manage identity, recovery, sessions, and trusted devices.</p>
        </div>
        <span className="account-local-badge">
          <span aria-hidden="true">✓</span> Local owner account
        </span>
      </header>
      <AccountSettings
        initialProfile={{
          name: user.name ?? "",
          email: user.email,
          passwordChangedAt: user.passwordChangedAt?.toISOString() ?? null,
        }}
        initialSessions={user.sessions.map((session) => ({
          ...session,
          current: session.id === current.sessionId,
          createdAt: session.createdAt.toISOString(),
          lastSeenAt: session.lastSeenAt.toISOString(),
          expiresAt: session.expiresAt.toISOString(),
        }))}
        securityEvents={user.auditEvents.map((event) => ({
          ...event,
          createdAt: event.createdAt.toISOString(),
        }))}
      />
      <PasskeyManager
        initialPasskeys={user.passkeys.map((key) => ({
          ...key,
          createdAt: key.createdAt.toISOString(),
          lastUsedAt: key.lastUsedAt?.toISOString() ?? null,
        }))}
      />
    </main>
  );
}
