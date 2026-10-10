import Link from "@/components/Link";
import { Suspense } from "react";
import { AccountChip } from "@/components/AccountChip";
import { BottomNav } from "@/components/BottomNav";
import { Wordmark } from "@/components/brand/Logo";
import { site } from "@/config/site";
import { type AccountSummary, getAccountSummary } from "@/lib/account-value";
import { getCurrentUser } from "@/lib/auth/session";

// Streams in after the rest of the page so pricing never delays the first paint.
async function AccountValue({ userId }: { userId: string }) {
  let summary: AccountSummary | null = null;
  try {
    summary = await getAccountSummary(userId);
  } catch (err) {
    console.error("[nav] account summary:", err instanceof Error ? err.message : err);
  }
  return <AccountChip initial={summary} />;
}

function AccountValueSkeleton() {
  return <div aria-hidden="true" className="ml-1 h-9 w-24 animate-pulse rounded-lg bg-surface md:w-48" />;
}

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
            <Suspense fallback={<AccountValueSkeleton />}>
              <AccountValue userId={user.id} />
            </Suspense>
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
