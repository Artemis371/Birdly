"use client";

import { AreaSeries, ColorType, CrosshairMode, LineStyle, createChart, type IChartApi, type ISeriesApi, type UTCTimestamp } from "lightweight-charts";
import { useEffect, useRef, useState } from "react";
import { refresh, site } from "@/config/site";
import { pct } from "@/lib/format";
import type { ChartRange, PricePoint } from "@/lib/polymarket/types";

const RANGES: ChartRange[] = ["1H", "1D", "1W", "1M", "ALL"];
const EMPTY: PricePoint[] = [];

type Result = { key: string; ok: boolean; points: PricePoint[]; stale: boolean };

type ChartProps = {
  tokenId: string;
  label: string;
  liveProb?: number | null;
  // Where to load history from; defaults to the public Polymarket history route.
  historyBase?: string;
};

export function PriceChart({ tokenId, label, liveProb, historyBase }: ChartProps) {
  const base = historyBase ?? `/api/history?token=${tokenId}`;
  const [range, setRange] = useState<ChartRange>("1D");
  const [result, setResult] = useState<Result | null>(null);
  const key = `${base}|${range}`;
  const current = result?.key === key ? result : null;
  const points = current?.points ?? EMPTY;
  const status: "loading" | "ok" | "error" = !current ? "loading" : current.ok ? "ok" : "error";
  const [hover, setHover] = useState<{ p: number; t: number } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const series = useRef<ISeriesApi<"Area"> | null>(null);
  const fitted = useRef(false);

  // Create the chart once.
  useEffect(() => {
    if (!box.current) return;
    const c = site.colors;
    const api = createChart(box.current, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: c.muted, fontSize: 11, attributionLogo: false },
      grid: { vertLines: { visible: false }, horzLines: { color: c.border, style: LineStyle.Dotted } },
      rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.12, bottom: 0.08 } },
      timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false },
      crosshair: {
        mode: CrosshairMode.Magnet,
        vertLine: { color: c.muted, labelBackgroundColor: c.surface2 },
        horzLine: { color: c.muted, labelBackgroundColor: c.surface2 },
      },
      handleScroll: false,
      handleScale: false,
      localization: { priceFormatter: (v: number) => `${Math.round(v * 100)}%` },
    });
    const s = api.addSeries(AreaSeries, {
      lineColor: c.accent,
      lineWidth: 2,
      topColor: `${c.accent}55`,
      bottomColor: `${c.accent}00`,
      priceLineVisible: false,
      lastValueVisible: true,
      crosshairMarkerRadius: 4,
      crosshairMarkerBorderColor: c.surface,
      crosshairMarkerBorderWidth: 2,
      autoscaleInfoProvider: (base: () => { priceRange: { minValue: number; maxValue: number } } | null) => {
        const r = base();
        if (!r) return r;
        // Keep a little vertical context so flat lines don't look like crashes.
        const pad = Math.max(0.02, (r.priceRange.maxValue - r.priceRange.minValue) * 0.1);
        return { priceRange: { minValue: Math.max(0, r.priceRange.minValue - pad), maxValue: Math.min(1, r.priceRange.maxValue + pad) } };
      },
    });
    api.subscribeCrosshairMove((param) => {
      const d = param.seriesData.get(s) as { value?: number } | undefined;
      if (param.time && d?.value !== undefined) setHover({ p: d.value, t: Number(param.time) });
      else setHover(null);
    });
    chart.current = api;
    series.current = s;
    return () => {
      api.remove();
      chart.current = null;
      series.current = null;
    };
  }, []);

  // Load + poll history for the selected token and range.
  useEffect(() => {
    let cancelled = false;
    fitted.current = false;
    const k = `${base}|${range}`;
    async function load() {
      try {
        const res = await fetch(`${base}&range=${range}`);
        if (!res.ok) throw new Error(String(res.status));
        const body = (await res.json()) as { points: PricePoint[]; stale: boolean };
        if (!cancelled) setResult({ key: k, ok: true, points: body.points, stale: body.stale });
      } catch {
        // Keep showing what we had for this range, flagged as delayed.
        if (!cancelled)
          setResult((prev) => (prev?.key === k && prev.points.length ? { ...prev, stale: true } : { key: k, ok: false, points: [], stale: true }));
      }
    }
    load();
    const id = setInterval(() => {
      if (document.visibilityState === "visible") load();
    }, refresh.chartMs);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [base, range]);

  // Push data into the chart.
  useEffect(() => {
    if (!series.current || !chart.current) return;
    series.current.setData(points.map((pt) => ({ time: pt.t as UTCTimestamp, value: pt.p })));
    if (!fitted.current && points.length) {
      chart.current.timeScale().fitContent();
      fitted.current = true;
    }
  }, [points]);

  const latest = points.at(-1);
  const firstPt = points[0];
  // Header shows the live book price when available; history lags by up to a minute.
  const shown = hover ?? (liveProb != null ? { p: liveProb, t: 0 } : latest ? { p: latest.p, t: latest.t } : null);
  const change = shown && firstPt ? shown.p - firstPt.p : null;

  return (
    <section aria-label={`${label} price history`}>
      <div className="mb-2 flex items-end justify-between gap-3">
        <div>
          <div className="text-xs text-muted">{label}</div>
          <div className="flex items-baseline gap-2">
            <span className="tabular text-2xl font-bold text-accent">{shown ? pct(shown.p) : "--"}</span>
            <span className="text-sm text-muted">chance</span>
            {!hover && change !== null && Math.abs(change) >= 0.005 ? (
              <span className={`tabular text-sm font-medium ${change > 0 ? "text-yes" : "text-no"}`}>
                {change > 0 ? "▲" : "▼"} {Math.round(Math.abs(change) * 100)} pts
              </span>
            ) : null}
          </div>
          {hover ? <div className="tabular text-xs text-muted">{new Date(hover.t * 1000).toLocaleString()}</div> : null}
        </div>
        {current?.stale ? <span className="text-xs text-warn">Chart may be delayed</span> : null}
      </div>

      <div className="relative h-56 sm:h-72">
        <div ref={box} className="absolute inset-0" />
        {status !== "ok" || points.length === 0 ? (
          <div className="absolute inset-0 grid place-items-center text-sm text-muted">
            {status === "loading" ? "Loading chart…" : status === "error" ? "Chart unavailable right now" : "No price data in this range yet"}
          </div>
        ) : null}
      </div>

      <div className="mt-2 flex gap-1" role="tablist" aria-label="Time range">
        {RANGES.map((r) => (
          <button
            key={r}
            role="tab"
            aria-selected={r === range}
            onClick={() => setRange(r)}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${r === range ? "bg-surface-2 text-text" : "text-muted hover:text-text"}`}
          >
            {r === "ALL" ? "All" : r}
          </button>
        ))}
      </div>
    </section>
  );
}
