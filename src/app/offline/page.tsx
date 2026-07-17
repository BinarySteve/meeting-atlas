import { OfflineActions } from "./offline-actions";
import { APP_NAME } from "@/lib/brand";
import { BrandGlyph } from "../brand-glyph";

function OfflineIcon({ name }: { name: "lock" | "server" | "network" }) {
  const paths = {
    lock: <><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></>,
    server: <><rect x="3" y="4" width="18" height="6" rx="2"/><rect x="3" y="14" width="18" height="6" rx="2"/><path d="M7 7h.01M7 17h.01"/></>,
    network: <><path d="M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0"/><path d="m3 3 18 18"/><circle cx="12" cy="20" r=".5"/></>,
  };
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}

export default function OfflinePage() {
  return <main className="offline-page"><section className="offline-shell">
    <header className="offline-brand"><span className="brand-mark"><BrandGlyph/></span><strong>{APP_NAME}</strong><span className="offline-status"><i /> Offline</span></header>
    <div className="offline-hero"><p className="eyebrow">LOCAL SERVER UNREACHABLE</p><h1>You’re offline.<br/><span>Your meetings aren’t exposed.</span></h1><p>{APP_NAME} deliberately keeps private recordings, transcripts, summaries, and account data out of browser caches. Reconnect to your local server to continue.</p><OfflineActions /></div>
    <div className="offline-features">
      <article><span className="offline-feature-icon"><OfflineIcon name="lock"/></span><div><strong>Private by default</strong><p>No meeting content is stored for offline use.</p></div></article>
      <article><span className="offline-feature-icon"><OfflineIcon name="server"/></span><div><strong>Server work may continue</strong><p>Active processing can keep running on your local server.</p></div></article>
    </div>
    <aside className="offline-checklist"><span className="offline-feature-icon"><OfflineIcon name="network"/></span><div><strong>Can’t reconnect?</strong><ol><li>Confirm this device is on your home network.</li><li>Check that the Meeting Atlas server is awake.</li><li>Open the same secure address used during setup.</li></ol></div></aside>
    <footer>{APP_NAME} · Private local meeting workspace</footer>
  </section></main>;
}
