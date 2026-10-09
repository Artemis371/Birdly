"use client";

import { useState } from "react";
import type { AdminUserRow } from "@/lib/admin";
import { usd } from "@/lib/format";

export function AdminTable({ initial, selfId }: { initial: AdminUserRow[]; selfId: string }) {
  const [rows, setRows] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ kind: "ok" | "err"; text: string; link?: string } | null>(null);

  async function act(u: AdminUserRow, action: "reset" | "deactivate" | "reactivate" | "recovery_link") {
    const confirmText: Record<string, string> = {
      reset: `Reset ${u.displayName} to the starting balance? Their open positions will be cleared. Trade history is kept.`,
      deactivate: `Deactivate ${u.displayName}? They won't be able to log in or trade.`,
      reactivate: `Reactivate ${u.displayName}?`,
      recovery_link: `Generate a one-time password reset link for ${u.displayName}?`,
    };
    if (!window.confirm(confirmText[action])) return;
    setBusy(u.id + action);
    setNote(null);
    try {
      const res = await fetch(`/api/admin/users/${u.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
      const data = await res.json();
      if (!res.ok) return setNote({ kind: "err", text: data.error ?? "Failed." });
      if (action === "recovery_link") return setNote({ kind: "ok", text: `Reset link for ${u.displayName} (send it privately, expires in about an hour):`, link: data.link });
      setRows((rs) =>
        rs.map((r) =>
          r.id !== u.id ? r : action === "reset" ? { ...r, cash: data.cash, openPositions: 0 } : { ...r, deactivated: action === "deactivate" },
        ),
      );
      setNote({ kind: "ok", text: "Done." });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      {note ? (
        <div className={`mb-3 rounded-xl px-4 py-3 text-sm ${note.kind === "ok" ? "bg-yes/10 text-yes" : "bg-no/10 text-no"}`}>
          {note.text}
          {note.link ? (
            <div className="mt-2 flex gap-2">
              <input readOnly value={note.link} className="w-full rounded-lg bg-bg px-2 py-1 text-xs text-text" onFocus={(e) => e.currentTarget.select()} />
              <button className="rounded-lg bg-surface-2 px-3 text-xs text-text" onClick={() => navigator.clipboard.writeText(note.link!)}>
                Copy
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
      <ul className="space-y-2">
        {rows.map((u) => (
          <li key={u.id} className="rounded-2xl border border-line bg-surface p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div className="min-w-0">
                <span className="font-semibold">{u.displayName}</span>
                {u.id === selfId ? <span className="ml-2 text-xs text-accent">you</span> : null}
                {u.deactivated ? <span className="ml-2 rounded bg-no/15 px-1.5 py-0.5 text-xs text-no">deactivated</span> : null}
                <div className="truncate text-xs text-muted">{u.email}</div>
              </div>
              <div className="tabular text-right text-sm">
                {usd(u.cash)} cash · {u.openPositions} open
                <div className="text-xs text-muted">
                  joined {new Date(u.joinedAt).toLocaleDateString()} · last login {u.lastSignInAt ? new Date(u.lastSignInAt).toLocaleDateString() : "never"}
                </div>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2 text-xs">
              <Btn onClick={() => act(u, "reset")} busy={busy === u.id + "reset"}>Reset balance</Btn>
              <Btn onClick={() => act(u, "recovery_link")} busy={busy === u.id + "recovery_link"}>Reset link</Btn>
              {u.id !== selfId ? (
                u.deactivated ? (
                  <Btn onClick={() => act(u, "reactivate")} busy={busy === u.id + "reactivate"}>Reactivate</Btn>
                ) : (
                  <Btn danger onClick={() => act(u, "deactivate")} busy={busy === u.id + "deactivate"}>Deactivate</Btn>
                )
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Btn({ children, onClick, busy, danger }: { children: React.ReactNode; onClick: () => void; busy: boolean; danger?: boolean }) {
  return (
    <button onClick={onClick} disabled={busy} className={`rounded-lg px-3 py-2 font-medium disabled:opacity-50 ${danger ? "bg-no/15 text-no" : "bg-surface-2 text-text hover:bg-line"}`}>
      {busy ? "…" : children}
    </button>
  );
}
