"use client";

import { AreaSeries, ColorType, LineStyle, createChart } from "lightweight-charts";
import { useEffect, useRef } from "react";
import { site } from "@/config/site";
import { usd } from "@/lib/format";

// Account value over time (daily snapshots + today's live value).
export function ValueChart({ points }: { points: { day: string; total: number }[] }) {
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!box.current) return;
    const c = site.colors;
    const chart = createChart(box.current, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: c.muted, fontSize: 11, attributionLogo: false },
      grid: { vertLines: { visible: false }, horzLines: { color: c.border, style: LineStyle.Dotted } },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false },
      handleScroll: false,
      handleScale: false,
      localization: { priceFormatter: (v: number) => usd(v, { cents: false }) },
    });
    const s = chart.addSeries(AreaSeries, {
      lineColor: c.accent,
      lineWidth: 2,
      topColor: `${c.accent}55`,
      bottomColor: `${c.accent}00`,
      priceLineVisible: false,
      pointMarkersVisible: points.length < 3,
    });
    s.setData(points.map((p) => ({ time: p.day, value: p.total })));
    chart.timeScale().fitContent();
    return () => chart.remove();
  }, [points]);

  return <div ref={box} className="h-44 w-full" aria-label="Account value over time" role="img" />;
}
