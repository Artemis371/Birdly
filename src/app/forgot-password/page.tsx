import type { Metadata } from "next";
import { AuthCard } from "@/components/forms/Form";
import { ForgotForm } from "@/components/forms/AuthForms";

// Per-request: depends on the signed-in user.
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Reset password" };

export default async function ForgotPage(props: PageProps<"/forgot-password">) {
  const sp = await props.searchParams;
  return (
    <AuthCard title="Reset your password" subtitle="We'll email you a link to set a new one.">
      {sp.error === "expired" ? (
        <p className="mb-4 rounded-lg bg-warn/10 px-3 py-2 text-sm text-warn">That reset link expired or was already used. Request a new one.</p>
      ) : null}
      <ForgotForm />
    </AuthCard>
  );
}
