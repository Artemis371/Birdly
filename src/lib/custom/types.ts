// Shared (client-safe) types for custom "Leahys" markets.
export type CustomStatus = "draft" | "open" | "resolved";

export type CustomMarket = {
  id: string;
  slug: string;
  title: string;
  description: string;
  rules: string;
  outcomes: string[];
  q: number[];
  liquidity: number;
  endAt: string;
  status: CustomStatus;
  winningIndex: number | null;
  publishedAt: string | null;
  resolvedAt: string | null;
  notifySentAt: string | null;
  prices: number[];
  ended: boolean; // past end date
  hasTrades: boolean;
  volume: number;
};

export const CUSTOM_PREFIX = "custom:";
export const isCustomToken = (t: string) => t.startsWith(CUSTOM_PREFIX);
export const customConditionId = (id: string) => `${CUSTOM_PREFIX}${id}`;
export const customTokenId = (id: string, i: number) => `${CUSTOM_PREFIX}${id}:${i}`;
export function parseCustomToken(t: string): { marketId: string; index: number } | null {
  const m = /^custom:([0-9a-f-]{36}):(\d{1,2})$/.exec(t);
  return m ? { marketId: m[1], index: Number(m[2]) } : null;
}
