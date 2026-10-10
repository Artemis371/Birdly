"use client";

import Link from "@/components/Link";
import { useState } from "react";
import { Form } from "./Form";

// Full reload after auth changes so the server-rendered nav picks up the session.
const go = (to: string) => window.location.assign(to);

export function LoginForm({ next }: { next: string }) {
  return (
    <Form
      endpoint="/api/auth/login"
      submitLabel="Log in"
      onSuccess={() => go(next)}
      fields={[
        { name: "email", label: "Email", type: "email", autoComplete: "username" },
        { name: "password", label: "Password", type: "password", autoComplete: "current-password" },
      ]}
      footer={
        <div className="flex justify-between text-sm">
          <Link href="/forgot-password" className="text-accent">
            Forgot password?
          </Link>
          <Link href={`/signup?next=${encodeURIComponent(next)}`} className="text-muted hover:text-text">
            Need an account?
          </Link>
        </div>
      }
    />
  );
}

export function SignupForm({ next }: { next: string }) {
  return (
    <Form
      endpoint="/api/auth/signup"
      submitLabel="Create account"
      onSuccess={() => go(next)}
      fields={[
        { name: "inviteCode", label: "Invite code", autoComplete: "one-time-code", hint: "Get this from whoever invited you." },
        { name: "displayName", label: "Display name", autoComplete: "nickname", hint: "3 to 20 characters. This is what everyone sees." },
        { name: "email", label: "Email", type: "email", autoComplete: "username", hint: "Never shown to anyone else. This is what you log in with." },
        { name: "password", label: "Password", type: "password", autoComplete: "new-password", hint: "At least 8 characters, letters plus numbers or symbols." },
      ]}
      footer={
        <p className="text-center text-sm text-muted">
          Already have an account?{" "}
          <Link href={`/login?next=${encodeURIComponent(next)}`} className="text-accent">
            Log in
          </Link>
        </p>
      }
    />
  );
}

export function ForgotForm() {
  const [sent, setSent] = useState<string | null>(null);
  if (sent) return <p className="text-sm">{sent}</p>;
  return (
    <Form
      endpoint="/api/auth/forgot"
      submitLabel="Send reset link"
      onSuccess={(d) => setSent(String(d.message))}
      fields={[{ name: "email", label: "Email", type: "email", autoComplete: "email" }]}
      footer={<p className="text-xs text-muted">No email after a few minutes? Ask the admin for a reset link; they can send you one directly.</p>}
    />
  );
}

export function ResetForm() {
  return (
    <Form
      endpoint="/api/account/password"
      submitLabel="Set new password"
      onSuccess={() => go("/portfolio")}
      fields={[{ name: "newPassword", label: "New password", type: "password", autoComplete: "new-password", hint: "At least 8 characters, letters plus numbers or symbols." }]}
    />
  );
}
