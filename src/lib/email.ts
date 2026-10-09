import "server-only";

// Minimal email sender using Resend's HTTP API (no SDK needed).
// Env: RESEND_API_KEY, ADMIN_NOTIFY_EMAIL, optional EMAIL_FROM.
// Without a verified domain, Resend's default sender can only deliver to the
// email address of the Resend account itself, which is fine for admin alerts.

export function emailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.ADMIN_NOTIFY_EMAIL);
}

export async function sendAdminEmail(subject: string, html: string, text: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const key = process.env.RESEND_API_KEY;
  const to = process.env.ADMIN_NOTIFY_EMAIL;
  if (!key || !to) return { ok: false, error: "RESEND_API_KEY or ADMIN_NOTIFY_EMAIL not set" };
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: process.env.EMAIL_FROM || "Birdly <onboarding@resend.dev>", to: [to], subject, html, text }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return { ok: false, error: `Resend ${res.status}: ${(await res.text()).slice(0, 200)}` };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err).slice(0, 200) };
  }
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
