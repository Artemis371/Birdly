// Display formatting. Probabilities are 0..1 floats.

export function pct(p: number | null | undefined): string {
  if (p === null || p === undefined || !Number.isFinite(p)) return "--";
  const v = p * 100;
  if (v > 0 && v < 1) return "<1%";
  if (v < 100 && v > 99) return ">99%";
  return `${Math.round(v)}%`;
}

export function cents(p: number | null | undefined): string {
  if (p === null || p === undefined || !Number.isFinite(p)) return "--";
  // Round to 0.1¢ first so float noise (0.07 * 100 = 7.000000000000001) can't leak.
  const c = Math.round(p * 1000) / 10;
  return `${c}¢`;
}

export function usd(n: number, opts: { cents?: boolean } = {}): string {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: opts.cents === false ? 0 : 2,
    maximumFractionDigits: opts.cents === false ? 0 : 2,
  });
}

export function compactUsd(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "$0";
  return "$" + n.toLocaleString("en-US", { notation: "compact", maximumFractionDigits: 1 });
}

// Floors (never rounds up) so shown shares always match the $1-per-share payout.
export function shares(n: number): string {
  return (Math.floor(n * 100 + 1e-9) / 100).toLocaleString("en-US", { maximumFractionDigits: 2 });
}

export function timeLeft(iso: string | null, now = Date.now()): string | null {
  if (!iso) return null;
  const ms = Date.parse(iso) - now;
  if (!Number.isFinite(ms)) return null;
  // Many open markets have an endDate in the past (e.g. a game's start time) but
  // still trade, so don't claim "Ended" for them.
  if (ms <= 0) return null;
  const h = ms / 3_600_000;
  if (h < 1) return `${Math.max(1, Math.round(ms / 60_000))}m left`;
  if (h < 48) return `${Math.round(h)}h left`;
  const d = h / 24;
  if (d < 60) return `${Math.round(d)}d left`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

// Request-time clock for server components (these pages render per request).
export function nowMs(): number {
  return Date.now();
}
