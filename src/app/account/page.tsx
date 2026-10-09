import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { DisplayNameForm, PasswordForm } from "@/components/forms/AccountForms";
import { getCurrentUser } from "@/lib/auth/session";

// Per-request: depends on the signed-in user.
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Account" };

export default async function AccountPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/account");
  const joined = new Date(user.createdAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  return (
    <div className="mx-auto max-w-md space-y-4">
      <div>
        <h1 className="text-2xl font-bold">{user.displayName}</h1>
        <p className="text-sm text-muted">
          Joined {joined} · {user.email} <span className="text-xs">(only you can see this)</span>
        </p>
      </div>
      <section className="rounded-2xl border border-line bg-surface p-5">
        <DisplayNameForm current={user.displayName} />
      </section>
      <section className="rounded-2xl border border-line bg-surface p-5">
        <PasswordForm />
      </section>
      <form action="/api/auth/logout" method="post">
        <button className="w-full rounded-xl border border-line py-3 text-sm font-semibold text-muted hover:text-text">Log out</button>
      </form>
    </div>
  );
}
