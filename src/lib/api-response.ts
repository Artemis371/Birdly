// JSON responses with CDN caching so Vercel's edge shares results across users
// and instances (keeps us far under Polymarket's rate limits).
export function json(data: unknown, init: { sMaxAge?: number; status?: number } = {}) {
  const { sMaxAge = 0, status = 200 } = init;
  return Response.json(data, {
    status,
    headers: {
      "Cache-Control": sMaxAge > 0 ? `public, s-maxage=${sMaxAge}, stale-while-revalidate=${sMaxAge * 2}` : "no-store",
    },
  });
}

export const TOKEN_RE = /^\d{1,100}$/;
