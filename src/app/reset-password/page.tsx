import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AuthCard } from "@/components/forms/Form";
import { ResetForm } from "@/components/forms/AuthForms";
import { RECOVERY_COOKIE, recoveryValidFor } from "@/lib/auth/recovery";
import { getCurrentUser } from "@/lib/auth/session";

// Per-request: depends on the signed-in user.
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Set a new password" };

export default async function ResetPage() {
  const user = await getCurrentUser();
  const store = await cookies();
  if (!user || !recoveryValidFor(store.get(RECOVERY_COOKIE)?.value, user.id)) redirect("/forgot-password?error=expired");
  return (
    <AuthCard title="Set a new password" subtitle={`Signed in as ${user.displayName}.`}>
      <ResetForm />
    </AuthCard>
  );
}
