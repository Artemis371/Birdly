"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { href: "/", label: "Markets", icon: "M3 12l9-8 9 8M5 10v10h14V10" },
  { href: "/leaderboard", label: "Leaders", icon: "M8 21h8M12 17v4M7 4h10v5a5 5 0 01-10 0V4zM17 6h3v2a3 3 0 01-3 3M7 6H4v2a3 3 0 003 3" },
  { href: "/activity", label: "Activity", icon: "M3 12h4l3 8 4-16 3 8h4" },
  { href: "/portfolio", label: "Portfolio", icon: "M4 7h16v13H4zM9 7V4h6v3" },
];

// Phone-only tab bar for signed-in members.
export function BottomNav() {
  const path = usePathname();
  return (
    <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-bg/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
      <ul className="grid grid-cols-4">
        {ITEMS.map((it) => {
          const active = it.href === "/" ? path === "/" || path.startsWith("/event") || path.startsWith("/leahys") : path.startsWith(it.href);
          return (
            <li key={it.href}>
              <Link href={it.href} className={`flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium ${active ? "text-accent" : "text-muted"}`} aria-current={active ? "page" : undefined}>
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d={it.icon} />
                </svg>
                {it.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
