"use client";

import { useState } from "react";

export type FieldDef = {
  name: string;
  label: string;
  type?: string;
  autoComplete?: string;
  placeholder?: string;
  hint?: string;
  defaultValue?: string;
};

type Props = {
  fields: FieldDef[];
  endpoint: string;
  submitLabel: string;
  // Called with the JSON response on success.
  onSuccess: (data: Record<string, unknown>) => void;
  footer?: React.ReactNode;
};

// Small JSON form with per-field error display.
export function Form({ fields, endpoint, submitLabel, onSuccess, footer }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; field?: string } | null>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const values = Object.fromEntries(new FormData(e.currentTarget).entries());
    try {
      const res = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(values) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError({ message: data.error ?? "Something went wrong. Try again.", field: data.field });
        return;
      }
      onSuccess(data);
    } catch {
      setError({ message: "Couldn't reach the server. Check your connection." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      {fields.map((f) => (
        <div key={f.name}>
          <label htmlFor={f.name} className="mb-1 block text-sm font-medium">
            {f.label}
          </label>
          <input
            id={f.name}
            name={f.name}
            type={f.type ?? "text"}
            autoComplete={f.autoComplete}
            placeholder={f.placeholder}
            defaultValue={f.defaultValue}
            aria-invalid={error?.field === f.name}
            className={`w-full rounded-xl border bg-bg px-3 py-2.5 text-[16px] outline-none focus:border-accent ${
              error?.field === f.name ? "border-no" : "border-line"
            }`}
          />
          {error?.field === f.name ? (
            <p className="mt-1 text-sm text-no" role="alert">
              {error.message}
            </p>
          ) : f.hint ? (
            <p className="mt-1 text-xs text-muted">{f.hint}</p>
          ) : null}
        </div>
      ))}
      {error && !fields.some((f) => f.name === error.field) ? (
        <p className="rounded-lg bg-no/10 px-3 py-2 text-sm text-no" role="alert">
          {error.message}
        </p>
      ) : null}
      <button disabled={busy} className="w-full rounded-xl bg-accent py-3 font-semibold text-bg disabled:opacity-60">
        {busy ? "One sec…" : submitLabel}
      </button>
      {footer}
    </form>
  );
}

export function AuthCard({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="mx-auto mt-6 max-w-sm rounded-2xl border border-line bg-surface p-6">
      <h1 className="text-xl font-bold">{title}</h1>
      {subtitle ? <p className="mt-1 text-sm text-muted">{subtitle}</p> : null}
      <div className="mt-5">{children}</div>
    </div>
  );
}
