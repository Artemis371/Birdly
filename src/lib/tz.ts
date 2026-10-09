// Time zone helpers built on Intl (no dependencies). Work for any IANA zone,
// including ones with daylight saving.

function parts(utcMs: number, zone: string): Record<string, number> {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const out: Record<string, number> = {};
  for (const p of f.formatToParts(new Date(utcMs))) if (p.type !== "literal") out[p.type] = Number(p.value);
  return out;
}

// Offset of `zone` from UTC at a given instant, in ms (e.g. Honolulu = -10h).
function offsetMs(utcMs: number, zone: string): number {
  const p = parts(utcMs, zone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

// "2027-03-31T23:59" (wall-clock time in `zone`) -> ISO UTC string.
export function zonedInputToIso(local: string, zone: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(local);
  if (!m) return null;
  const guess = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] ?? 0));
  // Two passes handle DST boundaries correctly.
  let utc = guess - offsetMs(guess, zone);
  utc = guess - offsetMs(utc, zone);
  return Number.isFinite(utc) ? new Date(utc).toISOString() : null;
}

// ISO UTC -> "2027-03-31T23:59" wall-clock time in `zone` (for datetime-local).
export function isoToZonedInput(iso: string, zone: string): string {
  const p = parts(Date.parse(iso), zone);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

// "Mar 31, 2027, 11:59 PM HST"
export function formatInZone(iso: string, zone: string, opts: { time?: boolean } = { time: true }): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    month: "short",
    day: "numeric",
    year: "numeric",
    ...(opts.time ? { hour: "numeric", minute: "2-digit", timeZoneName: "short" } : {}),
  }).format(new Date(iso));
}
