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

  it("many viewers asking at once share one upstream request", async () => {
    let release: (v: number) => void = () => {};
    const load = vi.fn(() => new Promise<number>((r) => (release = r)));
    const all = Promise.all(Array.from({ length: 10 }, () => cached("shared-1", 2, load)));
    release(42);
    expect((await all).map((r) => r.data)).toEqual(Array(10).fill(42));
    expect(load).toHaveBeenCalledTimes(1);
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

describe("getJson backoff", () => {
  const ok = () => new Response(JSON.stringify({ ok: true }), { status: 200 });
  const status = (s: number) => new Response("nope", { status: s });

  afterEach(async () => {
    vi.unstubAllGlobals();
    (await import("./client")).__resetBreakers();
  });

  it("after a 429 or 5xx, skips calls to that endpoint for a while instead of hammering", async () => {
    vi.useFakeTimers();
    const { BackingOffError, getJson } = await import("./client");
    const fetch = vi.fn().mockResolvedValueOnce(status(429)).mockImplementation(async () => ok());
    vi.stubGlobal("fetch", fetch);
    await expect(getJson("https://clob.polymarket.com/books")).rejects.toThrow("429");
    await expect(getJson("https://clob.polymarket.com/books")).rejects.toBeInstanceOf(BackingOffError);
    expect(fetch).toHaveBeenCalledTimes(1); // the second call never left the server
    // Other endpoints are unaffected.
    await expect(getJson("https://clob.polymarket.com/prices-history?x=1")).resolves.toEqual({ ok: true });
    vi.advanceTimersByTime(1_000);
    await expect(getJson("https://clob.polymarket.com/books")).resolves.toEqual({ ok: true });
  });

  it("doubles the wait on repeated failures and resets on success", async () => {
    vi.useFakeTimers();
    const { BackingOffError, getJson } = await import("./client");
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => status(503)));
    await expect(getJson("https://gamma-api.polymarket.com/events/keyset")).rejects.toThrow("503"); // wait 1s
    vi.advanceTimersByTime(1_000);
    await expect(getJson("https://gamma-api.polymarket.com/events/keyset")).rejects.toThrow("503"); // wait 2s
    vi.advanceTimersByTime(1_500);
    await expect(getJson("https://gamma-api.polymarket.com/events/keyset")).rejects.toBeInstanceOf(BackingOffError);
    vi.advanceTimersByTime(500);
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => ok()));
    await expect(getJson("https://gamma-api.polymarket.com/events/keyset")).resolves.toEqual({ ok: true });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(status(503)).mockImplementation(async () => ok()));
    await expect(getJson("https://gamma-api.polymarket.com/events/keyset")).rejects.toThrow("503");
    vi.advanceTimersByTime(1_000); // back to a 1s wait after the success reset it
    await expect(getJson("https://gamma-api.polymarket.com/events/keyset")).resolves.toEqual({ ok: true });
  });

  it("a 404 (resolved market) is not an error worth backing off for", async () => {
    const { getJson } = await import("./client");
    const fetch = vi.fn().mockResolvedValueOnce(status(404)).mockImplementation(async () => ok());
    vi.stubGlobal("fetch", fetch);
    await expect(getJson("https://clob.polymarket.com/book?token_id=1")).rejects.toThrow("404");
    await expect(getJson("https://clob.polymarket.com/book?token_id=1")).resolves.toEqual({ ok: true });
  });

  it("trade execution (breaker: false) always makes the real call", async () => {
    const { getJson } = await import("./client");
    const fetch = vi.fn().mockResolvedValueOnce(status(503)).mockImplementation(async () => ok());
    vi.stubGlobal("fetch", fetch);
    await expect(getJson("https://clob.polymarket.com/book?token_id=1")).rejects.toThrow("503");
    await expect(getJson("https://clob.polymarket.com/book?token_id=1", { breaker: false })).resolves.toEqual({ ok: true });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("serves the last known data, marked stale, while backing off", async () => {
    vi.useFakeTimers();
    const { cached, getJson } = await import("./client");
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => ok()));
    const load = () => getJson("https://clob.polymarket.com/books");
    await cached("bo-1", 1, load);
    vi.advanceTimersByTime(1_100);
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => status(503)));
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await cached("bo-1", 1, load)).toMatchObject({ data: { ok: true }, stale: true });
    vi.advanceTimersByTime(500); // cache expired, but still inside the 1s backoff
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    expect(await cached("bo-1", 0.1, load)).toMatchObject({ data: { ok: true }, stale: true });
    expect(fetch).not.toHaveBeenCalled(); // Polymarket wasn't called again
  });
});
