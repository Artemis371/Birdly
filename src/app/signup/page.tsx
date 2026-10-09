import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthCard } from "@/components/forms/Form";
import { SignupForm } from "@/components/forms/AuthForms";
import { site, trading } from "@/config/site";
import { getCurrentUser } from "@/lib/auth/session";
import { safeNext } from "@/lib/auth/validation";
import { usd } from "@/lib/format";

// Per-request: depends on the signed-in user.
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Sign up" };

export default async function SignupPage(props: PageProps<"/signup">) {
  const sp = await props.searchParams;
  const next = safeNext(sp.next);
  if (await getCurrentUser()) redirect(next);
  return (
    <AuthCard title={`Join ${site.name}`} subtitle={`Invite only. You start with ${usd(trading.startingBalance, { cents: false })} in paper money.`}>
      <SignupForm next={next} />
    </AuthCard>
  );
}
