import "server-only";
import { randomUUID } from "node:crypto";
import { trading } from "@/config/site";
import { env } from "@/lib/env";
import { allow } from "@/lib/rate-limit";
import { adminClient } from "@/lib/supabase/admin";
import { currentSeasonId } from "@/lib/trading/deps";
import { getCustomBySlug } from "./markets";
import type { CustomTradeDeps } from "./trade";

const KNOWN = ["trade_too_large", "insufficient_funds", "insufficient_shares", "account_inactive", "market_resolved", "market_cancelled", "market_ended", "price_moved", "not_found", "amount_too_small", "invalid_market", "invalid_amount"];

export function customTradeDeps(): CustomTradeDeps {
  const db = adminClient();
  return {
    secret: env.supabaseSecretKey(),
    newId: randomUUID,
    claimQuote: (jti) => allow("quote-used", jti, { max: 1, windowSec: 300 }),
    getMarket: getCustomBySlug,
    sharesOwned: async (userId, tokenId) => {
      const { data } = await db.from("positions").select("shares").eq("user_id", userId).eq("token_id", tokenId).eq("season_id", await currentSeasonId()).maybeSingle();
      return Number(data?.shares ?? 0);
    },
    execute: async (a) => {
      const { data, error } = await db.rpc("execute_custom_trade", {
        p_user_id: a.userId,
        p_market_id: a.marketId,
        p_index: a.index,
        p_side: a.side,
        p_amount: a.amount,
        p_ref_avg: a.refAvg,
        p_tolerance: trading.quoteTolerance,
        p_max_trade: trading.maxTradeUsd,
      });
      if (error) {
        const code = KNOWN.find((k) => error.message.includes(k)) ?? "db_error";
        if (code === "db_error") console.error("[execute_custom_trade]", error.message);
        return { ok: false, code };
      }
      return { ok: true, cash: Number(data.cash), shares: Number(data.filled_shares), total: Number(data.total), avg: Number(data.avg), prices: (data.prices as number[]).map(Number) };
    },
  };
}
