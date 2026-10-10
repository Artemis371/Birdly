"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { CustomCategory } from "@/lib/custom/types";

// Admin: add, rename and reorder the custom market tabs. The order here is
// the order of the chips on the home page (right after "Trending").
export function CategoryManager({ categories }: { categories: CustomCategory[] }) {
  const router = useRouter();
  const [names, setNames] = useState<Record<number, string>>(() => Object.fromEntries(categories.map((c) => [c.id, c.label])));
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (categories.length === 1 && categories[0].id === 0) {
    return <p className="rounded-xl bg-warn/10 px-4 py-3 text-sm text-warn">Run migration 0007 in Supabase to manage tabs.</p>;
  }

  async function send(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/custom/categories", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await res.json();
      if (!res.ok) return setError(d.error ?? "Couldn't save that.");
      if (body.action === "create") setNewName("");
      router.refresh();
    } catch {
      setError("Couldn't reach the server.");
    } finally {
      setBusy(false);
    }
  }

  function move(i: number, dir: -1 | 1) {
    const ids = categories.map((c) => c.id);
    [ids[i], ids[i + dir]] = [ids[i + dir], ids[i]];
    send({ action: "reorder", ids });
  }

  const input = "min-w-0 flex-1 rounded-lg border border-line bg-bg px-3 py-2 text-[16px] outline-none focus:border-accent sm:text-sm";
  const btn = "rounded-lg bg-surface-2 px-2.5 py-2 text-xs font-medium hover:bg-line disabled:opacity-40";
  return (
    <section className="mb-6 rounded-2xl border border-line bg-surface p-4">
      <h2 className="text-lg font-semibold">Tabs</h2>
      <p className="mb-3 text-xs text-muted">Members-only chips on the home page, in this order. Renaming keeps the link the same.</p>
      {error ? <p className="mb-2 rounded-lg bg-no/10 px-3 py-2 text-sm text-no">{error}</p> : null}
      <ul className="space-y-2">
        {categories.map((c, i) => (
          <li key={c.id} className="flex items-center gap-2">
            <input aria-label={`Name of ${c.label}`} value={names[c.id] ?? c.label} maxLength={30} onChange={(e) => setNames({ ...names, [c.id]: e.target.value })} className={input} />
            {(names[c.id] ?? c.label).trim() !== c.label ? (
              <button onClick={() => send({ action: "rename", id: c.id, label: names[c.id] })} disabled={busy} className="rounded-lg bg-accent px-3 py-2 text-xs font-semibold text-bg disabled:opacity-50">
                Save
              </button>
            ) : null}
            <button aria-label={`Move ${c.label} up`} onClick={() => move(i, -1)} disabled={busy || i === 0} className={btn}>
              ↑
            </button>
            <button aria-label={`Move ${c.label} down`} onClick={() => move(i, 1)} disabled={busy || i === categories.length - 1} className={btn}>
              ↓
            </button>
          </li>
        ))}
      </ul>
      <form
        className="mt-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (newName.trim()) send({ action: "create", label: newName });
        }}
      >
        <input placeholder="New tab name" value={newName} maxLength={30} onChange={(e) => setNewName(e.target.value)} className={input} />
        <button type="submit" disabled={busy || !newName.trim()} className="rounded-lg bg-accent px-3 py-2 text-xs font-semibold text-bg disabled:opacity-50">
          Add tab
        </button>
      </form>
    </section>
  );
}
