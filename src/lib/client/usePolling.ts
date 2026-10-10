"use client";

import { useEffect, useRef } from "react";
import { refresh } from "@/config/site";
import { startPoller } from "./poller";
import { isHere, registerPoller, subscribe } from "./presence";

export type PollTask = (signal: AbortSignal) => Promise<unknown>;

// Runs `task` every `intervalMs` while the person is here (tab visible, not
// idle). Pauses otherwise and runs right away when they come back. A task
// that throws (or returns a rejected promise) counts as a failure: the next
// try waits interval x 2, x 4 ... up to refresh.maxBackoffMs, so a struggling
// server isn't hammered. Never runs two at once.
export function usePolling(task: PollTask, intervalMs: number, opts: { enabled?: boolean; immediate?: boolean } = {}) {
  const { enabled = true, immediate = false } = opts;
  const taskRef = useRef(task);
  useEffect(() => {
    taskRef.current = task;
  });

  useEffect(() => {
    if (!enabled) return;
    const poller = startPoller({ task: (signal) => taskRef.current(signal), intervalMs, maxBackoffMs: refresh.maxBackoffMs, isHere, immediate });
    let wasHere = isHere();
    const unregister = registerPoller();
    const unsubscribe = subscribe(() => {
      const here = isHere();
      if (here && !wasHere) poller.wake(); // came back: refresh now
      else if (!here) poller.pause();
      wasHere = here;
    });
    return () => {
      poller.stop();
      unsubscribe();
      unregister();
    };
  }, [enabled, intervalMs, immediate]);
}

// fetch() that throws on non-2xx, so usePolling backs off on 429/503.
// Default cache mode on purpose: "no-store" would send Cache-Control: no-cache
// and could make the CDN skip the shared cache that lets viewers share requests.
export async function fetchJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(String(res.status));
  return (await res.json()) as T;
}
