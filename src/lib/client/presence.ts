"use client";

import { refresh } from "@/config/site";

// Is the person actually here? Shared by every poller on the page.
//   - away: the tab is hidden (background tab, phone locked)
//   - idle: no mouse, touch or keyboard activity for refresh.idleTimeoutMs
// Polling runs only when neither is true. Coming back (tab visible again, or
// any interaction) wakes every poller at once so they refresh immediately.

type Listener = () => void;
const listeners = new Set<Listener>();
let started = false;
let idle = false;
let pollers = 0;
let idleTimer: ReturnType<typeof setTimeout> | undefined;
let lastArm = 0;

function emit() {
  for (const l of listeners) l();
}

function arm() {
  lastArm = Date.now();
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    idle = true;
    emit();
  }, refresh.idleTimeoutMs);
}

export function markActive() {
  if (idle) {
    idle = false;
    arm();
    emit();
  } else if (Date.now() - lastArm > 1_000) {
    arm(); // throttled: mousemove fires constantly
  }
}

function start() {
  if (started || typeof window === "undefined") return;
  started = true;
  const opts = { passive: true, capture: true } as const;
  for (const ev of ["pointerdown", "pointermove", "keydown", "touchstart", "wheel", "scroll"]) window.addEventListener(ev, markActive, opts);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") markActive(); // back from background or lock screen
    emit();
  });
  arm();
}

export function isHere(): boolean {
  return typeof document !== "undefined" && document.visibilityState === "visible" && !idle;
}

export function subscribe(l: Listener): () => void {
  start();
  listeners.add(l);
  return () => listeners.delete(l);
}

// For the "Paused, tap to resume" pill: idle while something wants to poll.
export function isPausedForIdle(): boolean {
  return idle && pollers > 0;
}

export function registerPoller(): () => void {
  pollers++;
  emit();
  return () => {
    pollers--;
    emit();
  };
}
