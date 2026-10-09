import "server-only";
import { customTokenPrices } from "@/lib/custom/markets";
import { isCustomToken } from "@/lib/custom/types";
import { getBooks } from "@/lib/polymarket/api";

// What one share of each token is worth right now if sold:
//   Polymarket tokens: the real best bid (null if no bid)
//   custom tokens: the current LMSR price
export async function markPrices(tokenIds: string[]): Promise<{ prices: Record<string, number | null>; stale: boolean }> {
  const poly = [...new Set(tokenIds.filter((t) => !isCustomToken(t)))];
  const custom = [...new Set(tokenIds.filter(isCustomToken))];
  const prices: Record<string, number | null> = {};
  let stale = false;
  if (poly.length) {
    try {
      const b = await getBooks(poly);
      stale = b.stale;
      for (const t of poly) prices[t] = b.data[t]?.bestBid ?? null;
    } catch {
      stale = true;
    }
  }
  if (custom.length) Object.assign(prices, await customTokenPrices(custom));
  return { prices, stale };
}
