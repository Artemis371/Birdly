import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startPoller } from "./poller";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const flush = () => vi.advanceTimersByTimeAsync(0);

describe("startPoller", () => {
  it("runs every interval while the person is here", async () => {
    const task = vi.fn().mockResolvedValue(undefined);
    const p = startPoller({ task, intervalMs: 5_000, maxBackoffMs: 60_000, isHere: () => true });
    await vi.advanceTimersByTimeAsync(4_999);
    expect(task).toHaveBeenCalledTimes(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(task).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(task).toHaveBeenCalledTimes(3);
    p.stop();
  });

  it("stops while away and refreshes immediately on wake", async () => {
    let here = true;
    const task = vi.fn().mockResolvedValue(undefined);
    const p = startPoller({ task, intervalMs: 5_000, maxBackoffMs: 60_000, isHere: () => here });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(task).toHaveBeenCalledTimes(1);
    here = false;
    p.pause();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(task).toHaveBeenCalledTimes(1); // nothing while hidden or idle
    here = true;
    p.wake();
    await flush();
    expect(task).toHaveBeenCalledTimes(2); // right away, not after 5s
    await vi.advanceTimersByTimeAsync(5_000);
    expect(task).toHaveBeenCalledTimes(3); // and back on schedule
    p.stop();
  });

  it("backs off on failures (x2, x4 ... capped) and resets after a success", async () => {
    let fail = true;
    const task = vi.fn().mockImplementation(async () => {
      if (fail) throw new Error("503");
    });
    const p = startPoller({ task, intervalMs: 5_000, maxBackoffMs: 30_000, isHere: () => true });
    await vi.advanceTimersByTimeAsync(5_000); // 1st try fails
    expect(p.nextDelayMs).toBe(10_000);
    await vi.advanceTimersByTimeAsync(10_000); // 2nd fails
    expect(p.nextDelayMs).toBe(20_000);
    await vi.advanceTimersByTimeAsync(20_000); // 3rd fails
    expect(p.nextDelayMs).toBe(30_000); // capped
    await vi.advanceTimersByTimeAsync(29_999);
    expect(task).toHaveBeenCalledTimes(3);
    fail = false;
    await vi.advanceTimersByTimeAsync(1); // 4th succeeds
    expect(task).toHaveBeenCalledTimes(4);
    expect(p.nextDelayMs).toBe(5_000);
    p.stop();
  });

  it("never runs two at once", async () => {
    let release: () => void = () => {};
    const task = vi.fn().mockImplementation(() => new Promise<void>((r) => (release = r)));
    const p = startPoller({ task, intervalMs: 1_000, maxBackoffMs: 60_000, isHere: () => true, immediate: true });
    await flush();
    p.wake();
    p.wake();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(task).toHaveBeenCalledTimes(1); // still waiting on the first
    release();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(task).toHaveBeenCalledTimes(2);
    p.stop();
  });

  it("stop() ends polling and aborts the in-flight request", async () => {
    let signal: AbortSignal | undefined;
    const task = vi.fn().mockImplementation(async (s: AbortSignal) => {
      signal = s;
    });
    const p = startPoller({ task, intervalMs: 1_000, maxBackoffMs: 60_000, isHere: () => true, immediate: true });
    await flush();
    p.stop();
    expect(signal?.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(task).toHaveBeenCalledTimes(1);
  });
});
