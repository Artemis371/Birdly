import "server-only";
import { upstreamBackoff } from "@/config/site";
import type { Fetched } from "./types";

// Server-only HTTP + cache layer for Polymarket. The browser never calls
// Polymarket directly; it calls our /api routes, which call this.
//
// Two cache layers:
//  1. This in-memory TTL cache (per serverless instance), which also keeps the
//     last good value so we can serve stale data when Polymarket is down.
//  2. Cache-Control headers on our /api responses so Vercel's CDN shares
//     results across instances and users.

export const GAMMA = "https://gamma-api.polymarket.com";
export const CLOB = "https://clob.polymarket.com";

// Cloudflare in front of Polymarket rejects some default client User-Agents
// (Python's urllib got 403s in testing), so always send an explicit one.
const HEADERS = { "User-Agent": "Birdly/0.1 (private paper-trading app)", Accept: "application/json" };
const TIMEOUT_MS = 8_000;

export class PolymarketError extends Error {
  constructor(
    message: string,
    public status: number | null,
  ) {
    super(message);
  }
}

// Backoff ("circuit breaker") per endpoint, e.g. clob.polymarket.com/books.
// After a 429, a 5xx or a network failure, calls to that endpoint are skipped
// for 1s, 2s, 4s ... (config: upstreamBackoff) and callers serve their last
// known data marked stale instead of hammering Polymarket. One success resets it.
type Breaker = { failures: number; until: number };
const breakers = new Map<string, Breaker>();
const endpointOf = (url: URL) => `${url.host}/${url.pathname.split("/")[1] ?? ""}`;

export class BackingOffError extends PolymarketError {
  constructor(endpoint: string, ms: number) {
    super(`backing off ${endpoint} for ${Math.ceil(ms / 1000)}s after errors`, null);
  }
}

function recordFailure(endpoint: string) {
  const b = breakers.get(endpoint) ?? { failures: 0, until: 0 };
  b.failures++;
  const wait = Math.min(upstreamBackoff.firstMs * 2 ** (b.failures - 1), upstreamBackoff.maxMs);
  b.until = Date.now() + wait;
  breakers.set(endpoint, b);
}

export function __resetBreakers() {
  breakers.clear();
}

// `breaker: false` is for trade execution: it always makes the real call.
export async function getJson(url: string, init?: RequestInit & { breaker?: boolean }): Promise<unknown> {
  const { breaker = true, ...rest } = init ?? {};
  const u = new URL(url);
  const endpoint = endpointOf(u);
  if (breaker) {
    const b = breakers.get(endpoint);
    if (b && b.until > Date.now()) throw new BackingOffError(endpoint, b.until - Date.now());
  }
  let res: Response;
  try {
    res = await fetch(url, {
      ...rest,
      headers: { ...HEADERS, ...(rest.headers ?? {}) },
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    recordFailure(endpoint); // network error or timeout
    throw err;
  }
  if (!res.ok) {
    if (res.status === 429 || res.status >= 500) recordFailure(endpoint);
    let detail = "";
    try {
      detail = (await res.text()).slice(0, 200);
    } catch {}
    throw new PolymarketError(`${res.status} from ${u.host}${u.pathname}: ${detail}`, res.status);
  }
  breakers.delete(endpoint);
  return res.json();
}

type Entry = { value: unknown; fetchedAt: number; expiresAt: number };
const store = new Map<string, Entry>();
const inflight = new Map<string, Promise<unknown>>();
const MAX_ENTRIES = 2_000;
// How long a last-good value may be served when Polymarket is failing.
const STALE_LIMIT_MS = 6 * 60 * 60 * 1000;

function remember(key: string, value: unknown, ttlSec: number) {
  if (store.size >= MAX_ENTRIES) {
    const oldest = store.keys().next().value;
    if (oldest !== undefined) store.delete(oldest);
  }
  const now = Date.now();
  store.delete(key);
  store.set(key, { value, fetchedAt: now, expiresAt: now + ttlSec * 1000 });
}

// Fetch-through cache. On failure, returns the last good value marked stale.
// If there is no last good value, rethrows so the caller can render an error state.
export async function cached<T>(key: string, ttlSec: number, load: () => Promise<T>): Promise<Fetched<T>> {
  const hit = store.get(key);
  const now = Date.now();
  if (hit && hit.expiresAt > now) return { data: hit.value as T, stale: false, fetchedAt: hit.fetchedAt };

  let p = inflight.get(key) as Promise<T> | undefined;
  if (!p) {
    p = load();
    inflight.set(key, p);
    p.finally(() => inflight.delete(key)).catch(() => {});
  }
  try {
    const value = await p;
    remember(key, value, ttlSec);
    return { data: value, stale: false, fetchedAt: Date.now() };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!(err instanceof BackingOffError)) console.error(`[polymarket] ${key}: ${message}`);
    if (hit && now - hit.fetchedAt < STALE_LIMIT_MS) {
      return { data: hit.value as T, stale: true, fetchedAt: hit.fetchedAt, error: message };
    }
    throw err;
  }
}

