"use client";

import { useState } from "react";

// Wraps a live number. When `value` changes, the new number briefly gets a
// soft highlight (CSS .value-flash). Nothing moves: the text simply re-renders
// in place, and callers keep tabular figures and fixed widths.
export function Flash({ value, children, className = "" }: { value: string | number | null | undefined; children: React.ReactNode; className?: string }) {
  const [first] = useState(value);
  // The key remounts the span on each change so the animation replays.
  return (
    <span key={String(value)} className={`${className} ${value !== first ? "value-flash" : ""}`}>
      {children}
    </span>
  );
}
