import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthCard } from "@/components/forms/Form";
import { LoginForm } from "@/components/forms/AuthForms";
import { site } from "@/config/site";
import { getCurrentUser } from "@/lib/auth/session";
import { safeNext } from "@/lib/auth/validation";

// Per-request: depends on the signed-in user.
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Log in" };

export default async function LoginPage(props: PageProps<"/login">) {
  const sp = await props.searchParams;
  const next = safeNext(sp.next);
  if (await getCurrentUser()) redirect(next);
  return (
    <AuthCard title={`Log in to ${site.name}`} subtitle={site.tagline}>
      <LoginForm next={next} />
    </AuthCard>
  );
}
