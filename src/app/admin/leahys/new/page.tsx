import type { Metadata } from "next";
import Link from "@/components/Link";
import { notFound, redirect } from "next/navigation";
import { CustomMarketForm } from "@/components/custom/CustomMarketForm";
import { getCurrentUser } from "@/lib/auth/session";
import { listCategories } from "@/lib/custom/categories";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "New market" };

export default async function NewCustomPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/admin/leahys/new");
  if (!user.isAdmin) notFound();
  return (
    <div className="mx-auto max-w-xl">
      <Link href="/admin/leahys" className="text-sm text-muted hover:text-text">
        ← Back
      </Link>
      <h1 className="mb-4 text-2xl font-bold">New market</h1>
      <CustomMarketForm categories={await listCategories()} />
    </div>
  );
}
