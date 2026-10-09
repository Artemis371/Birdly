import "server-only";
import { randomUUID } from "node:crypto";
import { env } from "@/lib/env";
import { getEvent, getFreshBook } from "@/lib/polymarket/api";
import { LIMITS, allow } from "@/lib/rate-limit";
import { adminClient } from "@/lib/supabase/admin";
import type { TradeDeps } from "./execute";

const KNOWN = new Set(["trade_too_large", "insufficient_funds", "insufficient_shares", "account_inactive", "market_resolved", "invalid_market", "invalid_amount", "no_balance"]);

export async function currentSeasonId(): Promise<number> {
  const { data } = await adminClient().from("seasons").select("id").eq("is_current", true).single();
  return data?.id ?? 1;
}

export function tradeDeps(): TradeDeps {
  const db = adminClient();
  return {
    secret: env.supabaseSecretKey(),
    getEvent,
    getFreshBook,
    newId: randomUUID,
    claimQuote: (jti) => allow("quote-used", jti, { max: 1, windowSec: 300 }),
    sharesOwned: async (userId, tokenId) => {
      const { data } = await db
        .from("positions")
        .select("shares")
        .eq("user_id", userId)
        .eq("token_id", tokenId)
        .eq("season_id", await currentSeasonId())
        .maybeSingle();
      return Number(data?.shares ?? 0);
    },
    executeTrade: async (a) => {
      const { data, error } = await db.rpc("execute_trade", {
        p_user_id: a.userId,
        p_side: a.side,
        p_token_id: a.tokenId,
        p_shares: a.shares,
        p_amount: a.amount,
        p_price: a.price,
        p_market: a.market,
      });
      if (error) {
        const code = [...KNOWN].find((k) => error.message.includes(k)) ?? "db_error";
        if (code === "db_error") console.error("[execute_trade]", error.message);
        return { ok: false, code };
      }
      return { ok: true, cash: Number(data.cash), shares: Number(data.shares), tradeId: Number(data.trade_id) };
    },
  };
}

export const tradeLimit = (userId: string) => allow("trade-user", userId, LIMITS.tradePerUser);
