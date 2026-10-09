import { site } from "@/config/site";
import { BIRD_BODY, BIRD_EYE, BIRD_VIEWBOX, BIRD_WING } from "./bird";

export function BirdMark({ className = "h-7 w-7" }: { className?: string }) {
  return (
    <svg viewBox={BIRD_VIEWBOX} className={className} aria-hidden="true">
      <path d={BIRD_BODY} fill="var(--accent)" />
      <path d={BIRD_WING} fill="none" stroke="var(--bg)" strokeWidth={1.6} strokeLinecap="round" />
      <circle {...BIRD_EYE} fill="var(--bg)" />
    </svg>
  );
}

export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`}>
      <BirdMark />
      <span className="text-xl font-bold tracking-tight text-[var(--text)]">
        {site.name.toLowerCase()}
        <span className="text-[var(--accent)]">.</span>
      </span>
    </span>
  );
}
