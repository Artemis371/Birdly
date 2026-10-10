"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { customMarketTimeZone } from "@/config/site";
import { costToMove } from "@/lib/lmsr/lmsr";
import { formatInZone, isoToZonedInput, zonedInputToIso } from "@/lib/tz";
import type { CustomCategory, CustomMarket } from "@/lib/custom/types";
import { DEFAULT_LIQUIDITY } from "@/lib/custom/validate";
import { usd } from "@/lib/format";

// End dates are entered and shown in the configured zone (Hawaii by default),
// no matter what time zone the admin's device is in.
const TZ = customMarketTimeZone.zone;

// `categories` is only passed when creating; existing markets move from the list page.
export function CustomMarketForm({ market, categories }: { market?: CustomMarket; categories?: CustomCategory[] }) {
  const locked = !!market?.hasTrades; // only description + end date editable
  const [liquidity, setLiquidity] = useState(String(market?.liquidity ?? DEFAULT_LIQUIDITY));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ text: string; field?: string } | null>(null);
  const b = Number(liquidity) || DEFAULT_LIQUIDITY;
  const [endLocal, setEndLocal] = useState(market ? isoToZonedInput(market.endAt, TZ) : "");
  const endIso = endLocal ? zonedInputToIso(endLocal, TZ) : null;
  const submitMode = useRef<"save" | "publish">("save");
  const router = useRouter();

  async function submit(e: React.FormEvent<HTMLFormElement>, mode: "save" | "publish") {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const body = {
      action: mode,
      publish: mode === "publish",
      title: fd.get("title"),
      slug: fd.get("slug"),
      description: fd.get("description"),
      rules: fd.get("rules"),
      outcomes: String(fd.get("outcomes") ?? "").split("\n"),
      endAt: endIso ?? "",
      liquidity: fd.get("liquidity"),
      categoryId: fd.get("categoryId") ? Number(fd.get("categoryId")) : undefined,
    };
    if (mode === "publish" && !window.confirm("Publish now? Trading opens immediately at equal odds.")) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(market ? `/api/admin/custom/${market.id}` : "/api/admin/custom", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await res.json();
      if (!res.ok) return setError({ text: d.error ?? "Couldn't save.", field: d.field });
      router.push("/admin/leahys");
      router.refresh();
    } catch {
      setError({ text: "Couldn't reach the server." });
    } finally {
      setBusy(false);
    }
  }

  const input = "w-full rounded-xl border border-line bg-bg px-3 py-2.5 text-[16px] outline-none focus:border-accent read-only:opacity-60 sm:text-sm";
  const err = (f: string) => (error?.field === f ? <p className="mt-1 text-sm text-no">{error.text}</p> : null);

  return (
    <form className="space-y-4" onSubmit={(e) => submit(e, submitMode.current)}>
      {locked ? (
        <p className="rounded-lg bg-warn/10 px-3 py-2 text-sm text-warn">This market has trades, so only the description and end date can change.</p>
      ) : null}
      {!market && categories?.length && categories[0].id > 0 ? (
        <div>
          <label className="mb-1 block text-sm font-medium" htmlFor="categoryId">Tab</label>
          <select id="categoryId" name="categoryId" defaultValue={categories[0].id} className={input}>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
      ) : null}
      <div>
        <label className="mb-1 block text-sm font-medium" htmlFor="title">Title</label>
        <input id="title" name="title" defaultValue={market?.title} readOnly={locked} className={input} />
        {err("title")}
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium" htmlFor="slug">URL name <span className="text-muted">(optional)</span></label>
        <input id="slug" name="slug" defaultValue={market?.slug} readOnly={locked} placeholder="made from the title if blank" className={input} />
        {err("slug")}
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium" htmlFor="description">Description</label>
        <textarea id="description" name="description" rows={3} defaultValue={market?.description} className={input} />
        {err("description")}
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium" htmlFor="rules">Resolution rules</label>
        <textarea id="rules" name="rules" rows={4} defaultValue={market?.rules} readOnly={locked} className={input} />
        {err("rules")}
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium" htmlFor="outcomes">Outcomes <span className="text-muted">(one per line; exactly one will win)</span></label>
        <textarea id="outcomes" name="outcomes" rows={5} defaultValue={market?.outcomes.join("\n") ?? "Yes\nNo"} readOnly={locked} className={input} />
        {err("outcomes")}
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium" htmlFor="endAt">
          End date <span className="text-muted">({customMarketTimeZone.label}, {endIso ? formatInZone(endIso, TZ).split(" ").pop() : TZ}; trading closes then)</span>
        </label>
        <input id="endAt" name="endAt" type="datetime-local" value={endLocal} onChange={(e) => setEndLocal(e.target.value)} className={input} />
        {endIso ? <p className="mt-1 text-xs text-muted">Closes {formatInZone(endIso, TZ)}</p> : null}
        {err("endAt")}
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium" htmlFor="liquidity">Liquidity</label>
        <input id="liquidity" name="liquidity" inputMode="numeric" value={liquidity} onChange={(e) => setLiquidity(e.target.value)} readOnly={locked} className={input} />
        {err("liquidity")}
        <p className="mt-1 text-xs text-muted">
          Higher = prices move less per dollar. At {b.toLocaleString()}, a yes/no market needs about {usd(costToMove(b, 0.5, 0.6), { cents: false })} of buying to go
          50% → 60%, and {usd(costToMove(b, 0.5, 0.75), { cents: false })} to reach 75%. Default {DEFAULT_LIQUIDITY.toLocaleString()}.
        </p>
      </div>
      {error && !error.field ? <p className="rounded-lg bg-no/10 px-3 py-2 text-sm text-no">{error.text}</p> : null}
      <div className="flex gap-2">
        <button type="submit" onClick={() => (submitMode.current = "save")} disabled={busy} className="flex-1 rounded-xl border border-line py-3 text-sm font-semibold disabled:opacity-50">
          {market && market.status !== "draft" ? "Save changes" : "Save draft"}
        </button>
        {!market || market.status === "draft" ? (
          <button type="submit" onClick={() => (submitMode.current = "publish")} disabled={busy} className="flex-1 rounded-xl bg-accent py-3 text-sm font-semibold text-bg disabled:opacity-50">
            Publish
          </button>
        ) : null}
      </div>
    </form>
  );
}
