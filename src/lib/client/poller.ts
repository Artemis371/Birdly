// The scheduling core of usePolling, kept free of React and the DOM so it can
// be tested with fake timers (poller.test.ts).
//   - runs `task` every intervalMs while isHere() is true
//   - never runs two at once
//   - a failed task backs off: interval x 2, x 4 ... capped at maxBackoffMs
//   - wake() runs it right away (person came back); pause() stops the timer

export type PollerOpts = {
  task: (signal: AbortSignal) => Promise<unknown>;
  intervalMs: number;
  maxBackoffMs: number;
  isHere: () => boolean;
  immediate?: boolean;
};

export function startPoller({ task, intervalMs, maxBackoffMs, isHere, immediate = false }: PollerOpts) {
  let stopped = false;
  let running = false;
  let failures = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const ctrl = new AbortController();

  const nextDelay = () => (failures ? Math.min(intervalMs * 2 ** failures, maxBackoffMs) : intervalMs);
  const schedule = () => {
    clearTimeout(timer);
    if (stopped || !isHere()) return; // wake() resumes
    timer = setTimeout(tick, nextDelay());
  };
  async function tick() {
    if (stopped || running || !isHere()) return;
    running = true;
    try {
      await task(ctrl.signal);
      failures = 0;
    } catch {
      if (ctrl.signal.aborted) return;
      failures++;
    } finally {
      running = false;
    }
    schedule();
  }

  if (immediate) void tick();
  else schedule();

  return {
    wake() {
      clearTimeout(timer);
      void tick();
    },
    pause() {
      clearTimeout(timer);
    },
    stop() {
      stopped = true;
      clearTimeout(timer);
      ctrl.abort();
    },
    get failures() {
      return failures;
    },
    get nextDelayMs() {
      return nextDelay();
    },
  };
}
