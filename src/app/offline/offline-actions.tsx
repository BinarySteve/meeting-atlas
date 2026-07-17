"use client";

import { useCallback, useEffect, useState } from "react";

export function OfflineActions() {
  const [checking, setChecking] = useState(false);
  const [message, setMessage] = useState("Reconnect, then check your local server.");

  const checkConnection = useCallback(async () => {
    setChecking(true);
    setMessage("Looking for your local server…");
    try {
      const response = await fetch("/api/health", { cache: "no-store" });
      if (!response.ok) throw new Error();
      setMessage("Server found. Opening Meeting Atlas…");
      window.setTimeout(() => window.location.replace("/"), 450);
    } catch {
      setMessage(navigator.onLine ? "Network connected, but your local server is still unreachable." : "Still offline. Check your network connection.");
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    const handleOnline = () => void checkConnection();
    window.addEventListener("online", handleOnline);
    return () => window.removeEventListener("online", handleOnline);
  }, [checkConnection]);

  return <div className="offline-actions"><button className="button primary" disabled={checking} onClick={() => void checkConnection()}>{checking ? "Checking…" : "Check connection"}</button><p role="status">{message}</p></div>;
}
