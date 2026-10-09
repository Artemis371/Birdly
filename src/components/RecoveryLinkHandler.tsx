"use client";

import { useEffect, useState } from "react";

// Picks up Supabase's default password-reset redirect (tokens in the URL
// fragment) on any page and sends the person to "Set a new password".
export function RecoveryLinkHandler() {
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const hash = window.location.hash.startsWith("#") ? window.location.hash.slice(1) : "";
    if (!hash) return;
    const p = new URLSearchParams(hash);
    const isRecovery = p.get("type") === "recovery";
    const failed = p.get("error") || p.get("error_code");
    if (!isRecovery && !failed) return;

    // Remove the tokens from the address bar right away.
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
    if (failed) {
      window.location.replace("/forgot-password?error=expired");
      return;
    }
    const accessToken = p.get("access_token");
    const refreshToken = p.get("refresh_token");
    if (!accessToken || !refreshToken) return;

    // Deferred so React doesn't treat this as a synchronous render-time update.
    queueMicrotask(() => setBusy(true));
    fetch("/api/auth/recovery", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accessToken, refreshToken }),
    })
      .then((res) => window.location.replace(res.ok ? "/reset-password" : "/forgot-password?error=expired"))
      .catch(() => window.location.replace("/forgot-password?error=expired"));
  }, []);

  if (!busy) return null;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-bg/90 text-sm" role="status">
      Opening your password reset link…
    </div>
  );
}
