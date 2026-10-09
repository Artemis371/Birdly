import { CLOB, GAMMA } from "@/lib/polymarket/client";

// Diagnostics: can THIS server reach Polymarket's data endpoints? Open
// /api/health/polymarket on a Vercel deploy to check for geoblocking.
export const dynamic = "force-dynamic";

const UA = { "User-Agent": "Birdly/0.1 (private paper-trading app)" };

async function probe(name: string, url: string, init?: RequestInit) {
  const started = Date.now();
  try {
    const res = await fetch(url, { ...init, headers: { ...UA, ...(init?.headers ?? {}) }, cache: "no-store", signal: AbortSignal.timeout(8000) });
    const text = await res.text();
    return { name, url, status: res.status, ok: res.ok, ms: Date.now() - started, sample: text.slice(0, 160) };
  } catch (err) {
    return { name, url, status: null, ok: false, ms: Date.now() - started, sample: String(err).slice(0, 160) };
  }
}

export async function GET() {
  const events = await probe("gamma events/keyset", `${GAMMA}/events/keyset?closed=false&limit=1&order=volume24hr&ascending=false`);
  // Pull a real token id for the CLOB probes.
  let tokenId: string | null = null;
  try {
    const r = await fetch(`${GAMMA}/events/keyset?closed=false&limit=1&order=volume24hr&ascending=false`, { headers: UA, cache: "no-store" });
    const d = await r.json();
    type M = { clobTokenIds?: string; closed?: boolean; acceptingOrders?: boolean };
    const open = (d.events?.[0]?.markets as M[] | undefined)?.find((x) => x.clobTokenIds && !x.closed && x.acceptingOrders);
    const ids = JSON.parse(open?.clobTokenIds ?? "[]");
    tokenId = ids[0] ?? null;
  } catch {}
  const checks = [
    events,
    await probe("clob time", `${CLOB}/time`),
    ...(tokenId
      ? [
          await probe("clob book", `${CLOB}/book?token_id=${tokenId}`),
          await probe("clob prices-history", `${CLOB}/prices-history?market=${tokenId}&interval=1d&fidelity=60`),
        ]
      : []),
    // Informational only: Polymarket's own trading-geoblock check for this server's IP.
    await probe("polymarket geoblock (trading only)", "https://polymarket.com/api/geoblock"),
  ];
  const dataOk = checks.filter((c) => !c.name.startsWith("polymarket geoblock")).every((c) => c.ok);
  return Response.json(
    { dataEndpointsOk: dataOk, region: process.env.VERCEL_REGION ?? "local", checkedAt: new Date().toISOString(), checks },
    { headers: { "Cache-Control": "no-store" } },
  );
}
