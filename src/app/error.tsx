"use client";

export default function ErrorPage({ unstable_retry }: { error: Error & { digest?: string }; unstable_retry: () => void }) {
  return <main><section className="empty"><h1>Something went wrong</h1><p>Local request failed. No data was sent outside your network.</p><button onClick={() => unstable_retry()}>Try again</button></section></main>;
}
