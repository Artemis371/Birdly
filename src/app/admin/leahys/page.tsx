import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AdminCustomList } from "@/components/custom/AdminCustomList";
import { customTab } from "@/config/site";
import { getCurrentUser } from "@/lib/auth/session";
import { listAllCustom } from "@/lib/custom/markets";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: `Admin: ${customTab.label}` };

export default async function AdminCustomPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/admin/leahys");
  if (!user.isAdmin) notFound();
  const markets = await listAllCustom();
  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <Link href="/admin" className="text-sm text-muted hover:text-text">
            ← Admin
          </Link>
          <h1 className="text-2xl font-bold">{customTab.label} markets</h1>
        </div>
        <Link href="/admin/leahys/new" className="rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-bg">
          New market
        </Link>
      </div>
      <AdminCustomList markets={markets} />
    </div>
  );
}
