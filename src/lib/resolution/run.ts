import type { ClobMarket, Market } from "@/lib/polymarket/types";
import { decideResolution } from "./decide";

// The one resolution step, shared by the daily cron, portfolio page loads and
// the admin "Check now" button. Side effects are injected so it's testable.
// Safe to run concurrently or repeatedly: the database refuses to pay a market
// twice (resolve_market locks the market row and checks resolved_at).

export type Candidate = { conditionId: string; tokenIds: string[] };

export type ResolutionDeps = {
  candidates: () => Promise<Candidate[]>;
  // Gamma markets keyed by condition id (closed AND open; missing = not found).
  gammaMarkets: (conditionIds: string[]) => Promise<Map<string, Market>>;
  clobMarket: (conditionId: string) => Promise<ClobMarket | null>;
  resolve: (conditionId: string, payouts: Record<string, number>, note: string) => Promise<{ alreadyResolved: boolean; paidPositions: number; totalPaid: number }>;
  note: (conditionId: string, reason: string, closed: boolean) => Promise<void>;
  now?: () => number;
};

export type ResolutionSummary = {
  checked: number;
  paid: { conditionId: string; paidPositions: number; totalPaid: number }[];
  waiting: { conditionId: string; reason: string }[];
  errors: { conditionId: string; error: string }[];
  timedOut: boolean;
};

export async function runResolution(deps: ResolutionDeps, opts: { deadlineMs?: number } = {}): Promise<ResolutionSummary> {
  const now = deps.now ?? Date.now;
  const deadline = opts.deadlineMs ? now() + opts.deadlineMs : Infinity;
  const summary: ResolutionSummary = { checked: 0, paid: [], waiting: [], errors: [], timedOut: false };

  const candidates = await deps.candidates();
  if (!candidates.length) return summary;

  let gamma: Map<string, Market>;
  try {
    gamma = await deps.gammaMarkets(candidates.map((c) => c.conditionId));
  } catch (err) {
    // Polymarket unreachable: leave everything for the next run.
    for (const c of candidates) summary.errors.push({ conditionId: c.conditionId, error: `Gamma unavailable: ${String(err).slice(0, 120)}` });
    return summary;
  }

  for (const c of candidates) {
    if (now() > deadline) {
      summary.timedOut = true;
      break;
    }
    summary.checked++;
    try {
      const g = gamma.get(c.conditionId) ?? null;
      // Only bother the CLOB when Gamma says it's resolved.
      const needsClob = g?.closed && (g.umaResolutionStatus === "resolved" || g.umaResolutionStatus === "settled");
      const clob = needsClob ? await deps.clobMarket(c.conditionId) : null;
      const d = decideResolution(c.tokenIds, g, clob, now());
      if (d.action === "pay") {
        const r = await deps.resolve(c.conditionId, d.payouts, d.note);
        if (!r.alreadyResolved) summary.paid.push({ conditionId: c.conditionId, paidPositions: r.paidPositions, totalPaid: r.totalPaid });
      } else {
        await deps.note(c.conditionId, d.reason, d.closed);
        summary.waiting.push({ conditionId: c.conditionId, reason: d.reason });
      }
    } catch (err) {
      summary.errors.push({ conditionId: c.conditionId, error: String(err).slice(0, 200) });
    }
  }
  return summary;
}
