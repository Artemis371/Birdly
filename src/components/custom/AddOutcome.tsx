"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { CustomMarket } from "@/lib/custom/types";
import { pct } from "@/lib/format";

// Add an outcome to a live market. The new option starts at the chosen chance;
// every existing option keeps its relative odds and is scaled down to make room.
export function AddOutcome({ market }: { market: CustomMarket }) {
  const [name, setName] = useState("");
  const [chance, setChance] = useState("5");
  const [rules, setRules] = useState(market.rules);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const router = useRouter();
  const p = Number(chance) / 100;
  const valid = name.trim().length > 0 && p >= 0.01 && p <= 0.5;
  const full = market.outcomes.length >= 12;

  async function submit() {
    if (!window.confirm(`Add "${name.trim()}" at ${pct(p)}?\n\nEvery other option drops to ${Math.round((1 - p) * 100)}% of its current chance. Shares and cash don't change. This can't be undone.`)) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/admin/custom/${market.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "add_outcome", name: name.trim(), startPrice: p, rules }),
      });
      const d = await res.json();
      if (!res.ok) return setMsg({ kind: "err", text: d.error ?? "Couldn't add it." });
      setMsg({ kind: "ok", text: `Added "${name.trim()}". It's live now.` });
      setName("");
      router.refresh();
    } catch {
      setMsg({ kind: "err", text: "Couldn't reach the server." });
    } finally {
      setBusy(false);
    }
  }

  const input = "w-full rounded-xl border border-line bg-bg px-3 py-2.5 text-[16px] outline-none focus:border-accent sm:text-sm";
  return (
    <section className="mt-8 rounded-2xl border border-line bg-surface p-4 text-sm">
      <h2 className="font-semibold">Add an outcome</h2>
      <p className="mt-1 text-muted">
        Works even after trading started. The new option starts at the chance you pick; every existing option keeps its relative odds and is scaled down to make
        room. Nobody&apos;s shares or cash change, but existing options get a bit cheaper.
      </p>
      {full ? (
        <p className="mt-3 text-warn">This market already has the maximum of 12 outcomes.</p>
      ) : (
        <div className="mt-3 space-y-3">
          <div>
            <label className="mb-1 block font-medium" htmlFor="new-outcome">New outcome</label>
            <input id="new-outcome" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="e.g. Making waffles or something" className={input} />
          </div>
          <div>
            <label className="mb-1 block font-medium" htmlFor="new-chance">Starting chance (%)</label>
            <input id="new-chance" inputMode="decimal" value={chance} onChange={(e) => setChance(e.target.value.replace(/[^\d.]/g, ""))} className={input} />
            <p className="mt-1 text-xs text-muted">Between 1 and 50. Others drop to {Number.isFinite(p) ? Math.round((1 - p) * 100) : "--"}% of their current chance.</p>
          </div>
          <div>
            <label className="mb-1 block font-medium" htmlFor="new-rules">Rules (optional update)</label>
            <textarea id="new-rules" rows={4} value={rules} onChange={(e) => setRules(e.target.value)} className={input} />
            <p className="mt-1 text-xs text-muted">Worth saying how the new option relates to the existing ones, so there&apos;s no argument at resolution time.</p>
          </div>
          {msg ? <p className={`rounded-lg px-3 py-2 ${msg.kind === "ok" ? "bg-yes/10 text-yes" : "bg-no/10 text-no"}`}>{msg.text}</p> : null}
          <button onClick={submit} disabled={!valid || busy} className="w-full rounded-xl bg-accent py-3 font-semibold text-bg disabled:opacity-40">
            {busy ? "Adding…" : "Add outcome"}
          </button>
        </div>
      )}
    </section>
  );
}
