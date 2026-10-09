import { nowMs } from "@/lib/format";

export function StaleBanner({ fetchedAt, what = "Prices" }: { fetchedAt: number; what?: string }) {
  const mins = Math.max(1, Math.round((nowMs() - fetchedAt) / 60_000));
  return (
    <div role="status" className="mb-4 rounded-xl border border-warn/40 bg-warn/10 px-4 py-3 text-sm text-warn">
      Can&apos;t reach live market data right now. {what} below are from about {mins} min ago, and trading is paused until it&apos;s back.
    </div>
  );
}

export function ErrorPanel({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-8 text-center">
      <p className="text-lg font-semibold">{title}</p>
      {children ? <div className="mt-2 text-sm text-muted">{children}</div> : null}
    </div>
  );
}
