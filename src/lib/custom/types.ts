// Shared (client-safe) types for custom markets (Leahys, Rooneys, ...).
export type CustomStatus = "draft" | "open" | "resolved" | "cancelled";

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
  cancelledAt: string | null;
  notifySentAt: string | null;
  prices: number[];
  ended: boolean; // past end date
  hasTrades: boolean;
  volume: number;
  categoryId: number | null; // null only before migration 0007 is run
};

// A members-only tab of custom markets (Leahys, Rooneys, ...), managed by admins.
export type CustomCategory = { id: number; slug: string; label: string; sortOrder: number };

export const CUSTOM_PREFIX = "custom:";
export const isCustomToken = (t: string) => t.startsWith(CUSTOM_PREFIX);
export const customConditionId = (id: string) => `${CUSTOM_PREFIX}${id}`;
export const customTokenId = (id: string, i: number) => `${CUSTOM_PREFIX}${id}:${i}`;
export function parseCustomToken(t: string): { marketId: string; index: number } | null {
  const m = /^custom:([0-9a-f-]{36}):(\d{1,2})$/.exec(t);
  return m ? { marketId: m[1], index: Number(m[2]) } : null;
}
