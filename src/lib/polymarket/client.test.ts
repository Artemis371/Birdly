import { afterEach, describe, expect, it, vi } from "vitest";
import { cached } from "./client";

afterEach(() => vi.useRealTimers());

describe("cached", () => {
  it("serves from cache within the TTL", async () => {
    const load = vi.fn().mockResolvedValue(1);
    await cached("k1", 60, load);
    const r = await cached("k1", 60, load);
    expect(r).toMatchObject({ data: 1, stale: false });
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("falls back to the last good value, marked stale, when Polymarket fails", async () => {
    vi.useFakeTimers();
    await cached("k2", 1, async () => "good");
    vi.advanceTimersByTime(2_000);
    vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await cached("k2", 1, async () => {
      throw new Error("503");
    });
    expect(r.data).toBe("good");
    expect(r.stale).toBe(true);
    expect(r.error).toContain("503");
  });

  it("throws when there is nothing to fall back to", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(cached("k3", 60, async () => Promise.reject(new Error("down")))).rejects.toThrow("down");
  });

  it("dedupes concurrent loads", async () => {
    const load = vi.fn(() => new Promise((r) => setTimeout(() => r(5), 10)));
    const [a, b] = await Promise.all([cached("k4", 60, load), cached("k4", 60, load)]);
    expect(a.data).toBe(5);
    expect(b.data).toBe(5);
    expect(load).toHaveBeenCalledTimes(1);
  });
});
