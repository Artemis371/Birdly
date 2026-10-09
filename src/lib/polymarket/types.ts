// Birdly's normalized view of Polymarket data. Raw API shapes are parsed in
// parse.ts so the rest of the app never touches double-encoded JSON strings.

export type Outcome = {
  name: string; // "Yes" / "No" (or team names on some sports markets)
  tokenId: string;
  // Gamma's displayed price. Gamma is CDN-cached ~5 min (confirmed live), so this
  // lags the CLOB. Display only, never used for fills.
  price: number | null;
};

export type ResolutionStatus =
  | "requested"
  | "proposed"
  | "disputed"
  | "resolved"
  | "settled"
  | null;

export type Market = {
  id: string;
  conditionId: string;
  slug: string;
  question: string;
  // Candidate label inside a multi-outcome event ("Candidate A"); falls back to question.
  label: string;
  image: string | null;
  outcomes: Outcome[];
  endDate: string | null;
  active: boolean;
  closed: boolean;
  archived: boolean;
  acceptingOrders: boolean;
  enableOrderBook: boolean;
  negRisk: boolean;
  bestBid: number | null; // display only
  bestAsk: number | null; // display only
  volume: number;
  volume24hr: number;
  liquidity: number;
  oneDayPriceChange: number | null;
  umaResolutionStatus: ResolutionStatus;
  closedTime: string | null;
};

export type Tag = { id: string; label: string; slug: string };

export type PolyEvent = {
  id: string;
  slug: string;
  title: string;
  description: string;
  image: string | null;
  endDate: string | null;
  startDate: string | null;
  createdAt: string | null;
  active: boolean;
  closed: boolean;
  negRisk: boolean;
  volume: number;
  volume24hr: number;
  liquidity: number;
  tags: Tag[];
  markets: Market[];
};

export type BookLevel = { price: number; size: number };

export type OrderBook = {
  tokenId: string;
  conditionId: string | null;
  // Sorted best-first: bids high to low, asks low to high.
  bids: BookLevel[];
  asks: BookLevel[];
  bestBid: number | null;
  bestAsk: number | null;
  tickSize: number | null;
  minOrderSize: number | null;
  timestamp: number | null; // ms
};

export type ClobMarket = {
  conditionId: string;
  active: boolean;
  closed: boolean;
  acceptingOrders: boolean;
  enableOrderBook: boolean;
  tokens: { tokenId: string; outcome: string; price: number | null; winner: boolean }[];
};

export type PricePoint = { t: number; p: number }; // t = unix seconds

export type ChartRange = "1H" | "1D" | "1W" | "1M" | "ALL";

// Every server data call returns this so pages can show stale data + a warning.
export type Fetched<T> = {
  data: T;
  stale: boolean;
  fetchedAt: number; // ms
  error?: string;
};
