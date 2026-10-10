import type { Metadata } from "next";
import Link from "@/components/Link";
import { notFound, redirect } from "next/navigation";
import { AddOutcome } from "@/components/custom/AddOutcome";
import { CustomMarketForm } from "@/components/custom/CustomMarketForm";
import { getCurrentUser } from "@/lib/auth/session";
import { getCustomById } from "@/lib/custom/markets";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Edit market" };

export default async function EditCustomPage(props: PageProps<"/admin/leahys/[id]">) {
  const user = await getCurrentUser();
  const { id } = await props.params;
  if (!user) redirect(`/login?next=/admin/leahys/${id}`);
  if (!user.isAdmin) notFound();
  const market = await getCustomById(id);
  if (!market) notFound();
  if (market.status === "resolved") redirect("/admin/leahys");
  return (
    <div className="mx-auto max-w-xl">
      <Link href="/admin/leahys" className="text-sm text-muted hover:text-text">
        ← Back
      </Link>
      <h1 className="mb-1 text-2xl font-bold">Edit market</h1>
      <p className="mb-4 text-sm text-muted">{market.status === "draft" ? "Draft: not visible to members yet." : "Published."}</p>
      <CustomMarketForm key={market.outcomes.join("\n")} market={market} />
      {market.status === "open" ? <AddOutcome market={market} /> : null}
    </div>
  );
}
