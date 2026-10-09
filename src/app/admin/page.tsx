import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { AdminTable } from "@/components/AdminTable";
import { AdminWaiting } from "@/components/AdminWaiting";
import { listUsers, listWaitingMarkets } from "@/lib/admin";
import { getCurrentUser } from "@/lib/auth/session";

// Per-request: depends on the signed-in user.
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Admin" };

export default async function AdminPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/admin");
  if (!user.isAdmin) notFound();
  const [users, waiting] = await Promise.all([listUsers(), listWaitingMarkets()]);
  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-4 text-2xl font-bold">Admin</h1>
      <AdminWaiting markets={waiting} />
      <h2 className="mb-1 text-lg font-semibold">Members</h2>
      <p className="mb-4 text-sm text-muted">{users.length} members. Emails are visible here only.</p>
      <AdminTable initial={users} selfId={user.id} />
    </div>
  );
}
