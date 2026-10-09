import Link from "next/link";
import { BottomNav } from "@/components/BottomNav";
import { Wordmark } from "@/components/brand/Logo";
import { site } from "@/config/site";
import { getCurrentUser } from "@/lib/auth/session";
import { usd } from "@/lib/format";

export async function Nav() {
  let user = null;
  try {
    user = await getCurrentUser();
  } catch {
    user = null; // auth hiccup: render the logged-out nav rather than break every page
  }
  const link = "rounded-lg px-2.5 py-2 text-muted hover:bg-surface hover:text-text sm:px-3";
  return (
    <nav className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-2 px-4">
      <Link href="/" aria-label={`${site.name} home`} className="shrink-0">
        <Wordmark />
      </Link>
      <div className="flex items-center gap-0.5 text-sm">
        <Link href="/" className={`${link} hidden md:block`}>
          Markets
        </Link>
        {user ? (
          <>
            <Link href="/leaderboard" className={`${link} hidden md:block`}>
              Leaderboard
            </Link>
            <Link href="/activity" className={`${link} hidden md:block`}>
              Activity
            </Link>
            <Link href="/portfolio" className={`${link} hidden md:block`}>
              Portfolio
            </Link>
            {user.isAdmin ? (
              <Link href="/admin" className={link}>
                Admin
              </Link>
            ) : null}
            <Link href="/account" className="tabular ml-1 rounded-lg bg-surface px-2.5 py-1.5 font-semibold text-text hover:bg-surface-2" title={`${user.displayName}'s account`}>
              {usd(user.cash, { cents: false })}
            </Link>
            <BottomNav />
          </>
        ) : (
          <>
            <Link href="/login" className={link}>
              Log in
            </Link>
            <Link href="/signup" className="ml-1 rounded-lg bg-accent px-3 py-1.5 font-semibold text-bg">
              Sign up
            </Link>
          </>
        )}
      </div>
    </nav>
  );
}
