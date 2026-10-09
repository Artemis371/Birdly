import "server-only";
import { fetchClobMarket, fetchGammaMarketsByCondition } from "@/lib/polymarket/api";
import { adminClient } from "@/lib/supabase/admin";
import { runResolution, type Candidate, type ResolutionDeps, type ResolutionSummary } from "./run";

// Markets with open positions that haven't been paid out yet.
// - userId: only that user's markets (lazy check on portfolio load)
// - minRecheckMs: skip markets checked more recently than this
async function loadCandidates(opts: { userId?: string; minRecheckMs?: number; limit?: number }): Promise<Candidate[]> {
  const db = adminClient();
  let q = db.from("positions").select("condition_id").gt("shares", 0);
  if (opts.userId) q = q.eq("user_id", opts.userId);
  const { data: pos, error } = await q.limit(5000);
  if (error) throw new Error(error.message);
  const ids = [...new Set((pos ?? []).map((p) => p.condition_id as string))];
  if (!ids.length) return [];

  const { data: markets, error: mErr } = await db
    .from("markets")
    .select("condition_id, outcomes, last_checked_at")
    .is("resolved_at", null)
    .in("condition_id", ids.slice(0, 500));
  if (mErr) throw new Error(mErr.message);

  const cutoff = opts.minRecheckMs ? Date.now() - opts.minRecheckMs : null;
  return (markets ?? [])
    .filter((m) => !cutoff || !m.last_checked_at || Date.parse(m.last_checked_at) < cutoff)
    .sort((a, b) => (a.last_checked_at ?? "").localeCompare(b.last_checked_at ?? "")) // least recently checked first
    .slice(0, opts.limit ?? 500)
    .map((m) => ({
      conditionId: m.condition_id,
      tokenIds: ((m.outcomes ?? []) as { token_id: string }[]).map((o) => o.token_id),
    }));
}

function deps(candidates: () => Promise<Candidate[]>): ResolutionDeps {
  const db = adminClient();
  return {
    candidates,
    gammaMarkets: fetchGammaMarketsByCondition,
    clobMarket: fetchClobMarket,
    resolve: async (conditionId, payouts, note) => {
      const { data, error } = await db.rpc("resolve_market", { p_condition_id: conditionId, p_payouts: payouts, p_note: note });
      if (error) throw new Error(error.message);
      return { alreadyResolved: !!data.already_resolved, paidPositions: Number(data.paid_positions), totalPaid: Number(data.total_paid) };
    },
    note: async (conditionId, reason, closed) => {
      const { error } = await db.rpc("note_resolution_check", { p_condition_id: conditionId, p_note: reason, p_closed: closed });
      if (error) throw new Error(error.message);
    },
  };
}

function log(source: string, s: ResolutionSummary) {
  if (s.checked || s.errors.length) {
    console.log(`[resolution:${source}] checked=${s.checked} paid=${s.paid.length} waiting=${s.waiting.length} errors=${s.errors.length}${s.timedOut ? " (timed out)" : ""}`);
  }
  for (const e of s.errors) console.error(`[resolution:${source}] ${e.conditionId}: ${e.error}`);
}

// Lazy, on portfolio load: only this user's markets, at most once per 5 min
// per market, and never holding the page up for more than a few seconds.
export async function resolveForUser(userId: string): Promise<ResolutionSummary | null> {
  try {
    const s = await runResolution(deps(() => loadCandidates({ userId, minRecheckMs: 5 * 60_000, limit: 15 })), { deadlineMs: 4_000 });
    log("portfolio", s);
    return s;
  } catch (err) {
    console.error("[resolution:portfolio]", err);
    return null; // never break the portfolio page over this
  }
}

// Everything, no throttle: daily cron and the admin "Check now" button.
export async function resolveAll(source: "cron" | "admin", deadlineMs: number): Promise<ResolutionSummary> {
  const s = await runResolution(deps(() => loadCandidates({})), { deadlineMs });
  log(source, s);
  return s;
}
