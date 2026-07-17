"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { APP_NAME } from "@/lib/brand";
import { BrandGlyph } from "./brand-glyph";

type IconName = "meetings" | "record" | "search" | "settings" | "lock";

function Icon({ name }: { name: IconName }) {
  const paths: Record<IconName, React.ReactNode> = {
    meetings: <><rect x="3" y="5" width="18" height="15" rx="2"/><path d="M8 3v4M16 3v4M3 10h18M7 14h4M7 17h7"/></>,
    record: <><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/></>,
    search: <><circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5"/></>,
    settings: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.8 1.8 0 0 0 .36 2l.05.05-2.76 2.76-.05-.05a1.8 1.8 0 0 0-2-.36 1.8 1.8 0 0 0-1.1 1.65V21H10v-.07A1.8 1.8 0 0 0 8.9 19.3a1.8 1.8 0 0 0-2 .36l-.05.05-2.76-2.76.05-.05a1.8 1.8 0 0 0 .36-2A1.8 1.8 0 0 0 2.85 14H2.8v-4h.07A1.8 1.8 0 0 0 4.5 8.9a1.8 1.8 0 0 0-.36-2l-.05-.05 2.76-2.76.05.05a1.8 1.8 0 0 0 2 .36A1.8 1.8 0 0 0 10 2.85V2.8h4v.07A1.8 1.8 0 0 0 15.1 4.5a1.8 1.8 0 0 0 2-.36l.05-.05 2.76 2.76-.05.05a1.8 1.8 0 0 0-.36 2A1.8 1.8 0 0 0 21.15 10h.05v4h-.07A1.8 1.8 0 0 0 19.4 15Z"/></>,
    lock: <><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></>,
  };
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [online, setOnline] = useState(true);
  const [installPrompt, setInstallPrompt] = useState<Event & { prompt: () => Promise<void> }>();
  const [installDismissed, setInstallDismissed] = useState(false);
  const [profileName, setProfileName] = useState("");
  const isLogin = pathname === "/login";
  const isStandalonePage = isLogin || pathname === "/offline";

  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    const install = (event: Event) => { event.preventDefault(); setInstallPrompt(event as Event & { prompt: () => Promise<void> }); };
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    queueMicrotask(() => setOnline(navigator.onLine));
    window.addEventListener("beforeinstallprompt", install);
    const installed = () => setInstallPrompt(undefined);
    window.addEventListener("appinstalled", installed);
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") void navigator.serviceWorker.register("/sw.js");
    return () => { window.removeEventListener("online", up); window.removeEventListener("offline", down); window.removeEventListener("beforeinstallprompt", install); window.removeEventListener("appinstalled", installed); };
  }, []);

  useEffect(() => {
    if (isStandalonePage) return;
    let active = true;
    void fetch("/api/account/profile", { cache: "no-store" })
      .then(async (response) => response.ok ? response.json() as Promise<{ profile: { name: string } }> : null)
      .then((result) => { if (active && result) setProfileName(result.profile.name); })
      .catch(() => undefined);
    const updateProfile = (event: Event) => {
      const name = (event as CustomEvent<{ name?: string }>).detail?.name;
      if (name) setProfileName(name);
    };
    window.addEventListener("profile-updated", updateProfile);
    return () => {
      active = false;
      window.removeEventListener("profile-updated", updateProfile);
    };
  }, [isStandalonePage]);

  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }

  if (isStandalonePage) return <>{children}</>;
  const nav = [
    { href: "/", label: "Meetings", icon: "meetings" as const, active: pathname === "/" || (pathname.startsWith("/meetings/") && pathname !== "/meetings/new") },
    { href: "/meetings/new", label: "Record or upload", shortLabel: "New", icon: "record" as const, active: pathname === "/meetings/new" },
    { href: "/search", label: "Search", icon: "search" as const, active: pathname === "/search" },
    { href: "/account", label: "Settings", icon: "settings" as const, active: pathname.startsWith("/account") },
  ];
  return <div className="app-frame">
    {!online && <div className="offline-banner" role="status"><strong>Connection lost.</strong> Private meeting data remains on your local server. <Link href="/offline">Offline help</Link></div>}
    <aside className="sidebar">
      <Link className="brand" href="/" aria-label={`${APP_NAME} home`}><span className="brand-mark"><BrandGlyph/></span><span>{APP_NAME}</span></Link>
      <nav className="sidebar-nav" aria-label="Primary">{nav.map((item) => <Link key={`${item.href}-${item.label}`} href={item.href} aria-current={item.active ? "page" : undefined}><Icon name={item.icon}/><span>{item.label}</span></Link>)}</nav>
      <div className="sidebar-spacer"/>
      <div className={`local-status ${online ? "online" : "offline"}`}><span className="local-status-icon"><Icon name="lock"/></span><span><strong>{online ? "Processing locally" : "Local server offline"}</strong><small>{online ? "Audio stays on this system" : "Reconnect to continue"}</small></span></div>
      {installPrompt && <button className="sidebar-action" onClick={async () => { await installPrompt.prompt(); setInstallPrompt(undefined); }}>Install {APP_NAME}</button>}
      <Link className="sidebar-profile" href="/account"><span className="avatar" aria-hidden="true">{profileInitials(profileName)}</span><span><strong>{profileName || "Your account"}</strong><small>Settings & security</small></span><Icon name="settings"/></Link>
      <button className="sign-out" onClick={() => void signOut()}>Sign out</button>
    </aside>
    <div className="app-content">{children}</div>
    {installPrompt && !installDismissed && <aside className="install-banner" aria-label="Install app"><span className="brand-mark"><BrandGlyph/></span><div><strong>Install {APP_NAME}</strong><small>Faster launch. Dedicated app window. Data stays local.</small></div><button className="button primary" onClick={async () => { await installPrompt.prompt(); setInstallPrompt(undefined); }}>Install</button><button className="install-dismiss" aria-label="Dismiss install suggestion" onClick={() => setInstallDismissed(true)}>×</button></aside>}
    <nav className="bottom-nav" aria-label="Primary">{nav.map((item) => <Link key={`${item.href}-${item.label}`} href={item.href} aria-current={item.active ? "page" : undefined}><Icon name={item.icon}/><span>{item.shortLabel ?? item.label}</span></Link>)}</nav>
  </div>;
}

function profileInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "YO";
  return `${parts[0][0]}${parts.length > 1 ? parts.at(-1)?.[0] ?? "" : ""}`.toUpperCase();
}
