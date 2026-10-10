"use client";

import { useSyncExternalStore } from "react";
import { isPausedForIdle, markActive, subscribe } from "@/lib/client/presence";

// "Paused, tap to resume": shown after the idle timeout while a page has live
// data. Any interaction resumes; tapping the pill is just the obvious one.
export function PausedIndicator() {
  const paused = useSyncExternalStore(subscribe, isPausedForIdle, () => false);
  if (!paused) return null;
  return (
    <button
      type="button"
      onClick={markActive}
      className="fixed bottom-20 left-1/2 z-50 -translate-x-1/2 rounded-full border border-line bg-surface-2/95 px-3.5 py-1.5 text-xs font-medium text-muted shadow-lg backdrop-blur md:bottom-5"
    >
      <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-warn align-middle" aria-hidden="true" />
      Paused, tap to resume
    </button>
  );
}
