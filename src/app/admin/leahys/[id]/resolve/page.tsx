import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ResolveCustom } from "@/components/custom/ResolveCustom";
import { getCurrentUser } from "@/lib/auth/session";
import { exposureByOutcome } from "@/lib/custom/exposure";
import { getCustomById } from "@/lib/custom/markets";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Resolve market" };

export default async function ResolveCustomPage(props: PageProps<"/admin/leahys/[id]/resolve">) {
  const user = await getCurrentUser();
  const { id } = await props.params;
  if (!user) redirect(`/login?next=/admin/leahys/${id}/resolve`);
  if (!user.isAdmin) notFound();
  const market = await getCustomById(id);
  if (!market || market.status === "draft") notFound();
  const exposure = await exposureByOutcome(market);
  return (
    <div className="mx-auto max-w-xl">
      <Link href="/admin/leahys" className="text-sm text-muted hover:text-text">
        ← Back
      </Link>
      <h1 className="mb-1 text-2xl font-bold">{market.title}</h1>
      <p className="mb-2 text-sm text-muted">Resolve this market. Winning shares pay $1 each, everything else pays $0.</p>
      <details className="mb-4 rounded-xl border border-line bg-surface p-3 text-sm">
        <summary className="cursor-pointer font-semibold">Rules</summary>
        <p className="mt-2 whitespace-pre-line text-muted">{market.rules}</p>
      </details>
      <ResolveCustom market={market} exposure={exposure} />
    </div>
  );
}
