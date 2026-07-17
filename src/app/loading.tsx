export default function Loading() {
  return <main className="page-shell loading-page" aria-busy="true">
    <header className="page-intro loading-intro"><div>
      <span className="skeleton skeleton-label" />
      <span className="skeleton skeleton-title" />
      <span className="skeleton skeleton-copy" />
    </div></header>
    <section className="loading-toolbar" aria-hidden="true">
      <span className="skeleton" />
      <span className="skeleton" />
      <span className="skeleton" />
    </section>
    <section aria-hidden="true">
      <div className="section-heading"><div><span className="skeleton skeleton-heading" /><span className="skeleton skeleton-count" /></div></div>
      <div className="meeting-grid">
        {[0, 1].map((item) => <div className="meeting-card loading-card" key={item}>
          <span className="skeleton skeleton-status" />
          <span className="skeleton skeleton-card-title" />
          <span className="skeleton skeleton-card-meta" />
        </div>)}
      </div>
    </section>
    <p className="sr-only" role="status">Loading local meeting data…</p>
  </main>;
}
