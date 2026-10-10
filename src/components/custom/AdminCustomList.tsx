"use client";

import Link from "@/components/Link";
import { useState } from "react";
import type { CustomMarket } from "@/lib/custom/types";
import { compactUsd } from "@/lib/format";
import { customMarketTimeZone } from "@/config/site";
import { formatInZone } from "@/lib/tz";

export function AdminCustomList({ markets }: { markets: CustomMarket[] }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function act(m: CustomMarket, action: "publish" | "delete") {
    const msg = action === "publish" ? `Publish "${m.title}"? Trading opens immediately at equal odds.` : `Delete the draft "${m.title}"? This can't be undone.`;
    if (!window.confirm(msg)) return;
    setBusy(m.id);
    setError(null);
    try {
      // Publishing reuses the market's saved fields as-is.
      const body =
        action === "publish"
          ? { action, slug: m.slug, title: m.title, description: m.description, rules: m.rules, outcomes: m.outcomes, endAt: m.endAt, liquidity: m.liquidity }
          : { action };
      const res = await fetch(`/api/admin/custom/${m.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await res.json();
      if (!res.ok) return setError(`${m.title}: ${d.error}`);
      window.location.reload();
    } finally {
      setBusy(null);
    }
  }

  const groups: [string, CustomMarket[]][] = [
    ["Needs a winner", markets.filter((m) => m.status === "open" && m.ended)],
    ["Drafts", markets.filter((m) => m.status === "draft")],
    ["Open", markets.filter((m) => m.status === "open" && !m.ended)],
    ["Resolved or cancelled", markets.filter((m) => m.status === "resolved" || m.status === "cancelled")],
  ];

  return (
    <div className="space-y-6">
      {error ? <p className="rounded-lg bg-no/10 px-3 py-2 text-sm text-no">{error}</p> : null}
      {groups.map(([title, list]) =>
        list.length ? (
          <section key={title}>
            <h2 className="mb-2 text-lg font-semibold">{title}</h2>
            <ul className="space-y-2">
              {list.map((m) => (
                <li key={m.id} className="rounded-2xl border border-line bg-surface p-4 text-sm">
                  <div className="font-semibold">{m.title}</div>
                  <div className="mt-0.5 text-xs text-muted">
                    {m.outcomes.length} outcomes · ends {formatInZone(m.endAt, customMarketTimeZone.zone)} · liquidity {m.liquidity.toLocaleString()} · {compactUsd(m.volume)} traded
                    {m.status === "resolved" ? ` · winner: ${m.outcomes[m.winningIndex ?? 0]}` : m.status === "cancelled" ? " · cancelled, refunded" : ""}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2 text-xs">
                    {m.status === "draft" ? (
                      <button onClick={() => act(m, "publish")} disabled={busy === m.id} className="rounded-lg bg-accent px-3 py-2 font-semibold text-bg disabled:opacity-50">
                        Publish
                      </button>
                    ) : null}
                    {m.status !== "resolved" && m.status !== "cancelled" ? (
                      <Link href={`/admin/leahys/${m.id}`} className="rounded-lg bg-surface-2 px-3 py-2 font-medium hover:bg-line">
                        Edit
                      </Link>
                    ) : null}
                    {m.status === "open" ? (
                      <Link href={`/admin/leahys/${m.id}/resolve`} className={`rounded-lg px-3 py-2 font-medium ${m.ended ? "bg-warn/20 text-warn" : "bg-surface-2 hover:bg-line"}`}>
                        {m.ended ? "Pick winner / cancel" : "Resolve or cancel"}
                      </Link>
                    ) : null}
                    <Link href={`/leahys/${m.slug}`} className="rounded-lg bg-surface-2 px-3 py-2 font-medium hover:bg-line">
                      {m.status === "draft" ? "Preview" : "View"}
                    </Link>
                    {m.status === "draft" ? (
                      <button onClick={() => act(m, "delete")} disabled={busy === m.id} className="rounded-lg bg-no/15 px-3 py-2 font-medium text-no disabled:opacity-50">
                        Delete
                      </button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ) : null,
      )}
    </div>
  );
}
