"use client";

import { useEffect, useId, useRef, useState } from "react";

export const ACCOUNT_VALUE_HELP =
  "Account value = cash + what your open positions would sell for right now. Buying shares moves money from cash into positions. Your value only changes when prices move or a market resolves.";

// Small "i" button that shows a short explanation. Tap or click to toggle
// (works on phones), hover or focus also opens it on desktop.
export function InfoTooltip({ text = ACCOUNT_VALUE_HELP, label = "What is this?", align = "left" }: { text?: string; label?: string; align?: "left" | "right" }) {
  const [open, setOpen] = useState(false);
  const [hover, setHover] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  const shown = open || hover;
  return (
    <span ref={ref} className="relative inline-flex align-middle" onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <button
        type="button"
        aria-label={label}
        aria-describedby={shown ? id : undefined}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        onFocus={() => setHover(true)}
        onBlur={() => setHover(false)}
        className="inline-flex h-4 w-4 items-center justify-center rounded-full text-muted hover:text-text focus-visible:text-text focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
      >
        <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
          <circle cx="8" cy="8" r="6.5" />
          <path d="M8 7.2v4" strokeLinecap="round" />
          <circle cx="8" cy="4.9" r="0.6" fill="currentColor" stroke="none" />
        </svg>
      </button>
      {shown ? (
        <span
          id={id}
          role="tooltip"
          className={`absolute top-full z-50 mt-2 w-64 max-w-[calc(100vw-2rem)] rounded-xl border border-line bg-surface-2 p-3 text-left text-xs font-normal normal-case leading-relaxed text-text shadow-lg ${
            align === "right" ? "right-0" : "left-0"
          }`}
        >
          {text}
        </span>
      ) : null}
    </span>
  );
}
