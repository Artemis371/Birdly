import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { AdminTable } from "@/components/AdminTable";
import { AdminWaiting } from "@/components/AdminWaiting";
import Link from "@/components/Link";
import { listEndedCustom, listUsers, listWaitingMarkets } from "@/lib/admin";
import { emailConfigured } from "@/lib/email";
import { getCurrentUser } from "@/lib/auth/session";

// Per-request: depends on the signed-in user.
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Admin" };

export default async function AdminPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/admin");
  if (!user.isAdmin) notFound();
  const [users, waiting, endedCustom] = await Promise.all([listUsers(), listWaitingMarkets(), listEndedCustom()]);
  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Admin</h1>
        <Link href="/admin/leahys" className="rounded-xl bg-surface-2 px-4 py-2 text-sm font-semibold hover:bg-line">
          Custom markets
        </Link>
      </div>
      <AdminWaiting markets={waiting} custom={endedCustom} emailOn={emailConfigured()} />
      <h2 className="mb-1 text-lg font-semibold">Members</h2>
      <p className="mb-4 text-sm text-muted">{users.length} members. Emails are visible here only.</p>
      <AdminTable initial={users} selfId={user.id} />
    </div>
  );
}
