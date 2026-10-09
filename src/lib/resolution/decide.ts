import type { ClobMarket, Market } from "@/lib/polymarket/types";

// The payout rule, from the live checks in docs/API_NOTES.md section 6:
//   pay only when Gamma says closed + resolved/settled, the final prices are
//   valid and sum to 1, and the CLOB agrees on every token. Each share pays its
//   final price ($1/$0, or $0.50/$0.50 on a 50/50). Anything else waits.
// Pure function: no I/O, so every branch is unit-tested.

export type Decision =
  | { action: "pay"; payouts: Record<string, number>; note: string }
  | { action: "wait"; reason: string; closed: boolean };

const SUM_TOLERANCE = 0.001;
const MATCH_TOLERANCE = 0.001;
const FINAL_VALUES = [0, 0.5, 1];

export function decideResolution(tokenIds: string[], gamma: Market | null, clob: ClobMarket | null, now = Date.now()): Decision {
  if (!gamma) return { action: "wait", reason: "Not found on Polymarket (it may have been removed). Needs a look.", closed: false };

  if (!gamma.closed) {
    const past = gamma.endDate && Date.parse(gamma.endDate) < now;
    return { action: "wait", reason: past ? "Past its end date but Polymarket hasn't closed it yet." : "Still open.", closed: false };
  }

  const status = gamma.umaResolutionStatus;
  if (status === "proposed") return { action: "wait", reason: "Closed. A result was proposed and is in its dispute window.", closed: true };
  if (status === "disputed") return { action: "wait", reason: "Closed. The proposed result is being disputed.", closed: true };
  if (status === "requested") return { action: "wait", reason: "Closed. Waiting for someone to propose a result.", closed: true };
  if (status !== "resolved" && status !== "settled") {
    return { action: "wait", reason: "Closed, but Polymarket hasn't reported a resolution status yet.", closed: true };
  }

  // Final prices from Gamma, for exactly the tokens we hold.
  const gammaPrice = new Map(gamma.outcomes.map((o) => [o.tokenId, o.price]));
  const raw: Record<string, number> = {};
  for (const t of tokenIds) {
    const p = gammaPrice.get(t);
    if (p === null || p === undefined || !Number.isFinite(p)) {
      return { action: "wait", reason: "Resolved, but Polymarket's final prices are missing for an outcome.", closed: true };
    }
    if (p < 0 || p > 1) return { action: "wait", reason: "Resolved, but a final price is out of range. Needs a look.", closed: true };
    raw[t] = p;
  }
  if (tokenIds.length !== gamma.outcomes.length) {
    return { action: "wait", reason: "Outcome list changed since trading. Needs a look.", closed: true };
  }
  const sum = Object.values(raw).reduce((a, b) => a + b, 0);
  if (Math.abs(sum - 1) > SUM_TOLERANCE) {
    return { action: "wait", reason: `Resolved, but final prices sum to ${sum.toFixed(4)}, not 1. Waiting for them to settle.`, closed: true };
  }
  // Snap float noise (e.g. 0.9999999) to the clean final value; anything that
  // isn't 0, 0.5 or 1 is unusual enough to hold for a human.
  const payouts: Record<string, number> = {};
  for (const [t, p] of Object.entries(raw)) {
    const snapped = FINAL_VALUES.find((v) => Math.abs(v - p) <= SUM_TOLERANCE);
    if (snapped === undefined) {
      return { action: "wait", reason: `Resolved, but a final price is ${p}, not 0, 0.5 or 1. Holding for a manual check.`, closed: true };
    }
    payouts[t] = snapped;
  }

  // Cross-check against the CLOB.
  if (!clob) return { action: "wait", reason: "Resolved on Gamma, but couldn't confirm with the CLOB API yet.", closed: true };
  if (!clob.closed) return { action: "wait", reason: "Resolved on Gamma, but the CLOB still shows the market open.", closed: true };
  const clobToken = new Map(clob.tokens.map((t) => [t.tokenId, t]));
  for (const [t, pay] of Object.entries(payouts)) {
    const c = clobToken.get(t);
    if (!c || c.price === null || Math.abs(c.price - pay) > MATCH_TOLERANCE) {
      return { action: "wait", reason: "Gamma and CLOB disagree on the final prices. Waiting for them to match.", closed: true };
    }
    // A full winner must be flagged by the CLOB; on a 50/50 nobody is.
    if ((pay === 1) !== c.winner) {
      return { action: "wait", reason: "Gamma and CLOB disagree on the winner. Waiting for them to match.", closed: true };
    }
  }

  const split = Object.values(payouts).every((v) => v === 0.5);
  return { action: "pay", payouts, note: split ? "Resolved 50/50." : "Resolved." };
}
