"use client";

import { useState } from "react";
import { Form } from "./Form";

export function DisplayNameForm({ current }: { current: string }) {
  const [saved, setSaved] = useState<string | null>(null);
  return (
    <>
      {saved ? <p className="mb-3 text-sm text-yes">Saved. You&apos;re now {saved}.</p> : null}
      <Form
        endpoint="/api/account/display-name"
        submitLabel="Save display name"
        onSuccess={(d) => {
          setSaved(String(d.displayName));
          window.location.reload();
        }}
        fields={[{ name: "displayName", label: "Display name", defaultValue: current, hint: "3 to 20 characters. Shown on the leaderboard and activity feed." }]}
      />
    </>
  );
}

export function PasswordForm() {
  const [done, setDone] = useState(false);
  const [key, setKey] = useState(0);
  return (
    <>
      {done ? <p className="mb-3 text-sm text-yes">Password changed.</p> : null}
      <Form
        key={key}
        endpoint="/api/account/password"
        submitLabel="Change password"
        onSuccess={() => {
          setDone(true);
          setKey((k) => k + 1);
        }}
        fields={[
          { name: "currentPassword", label: "Current password", type: "password", autoComplete: "current-password" },
          { name: "newPassword", label: "New password", type: "password", autoComplete: "new-password", hint: "At least 8 characters, letters plus numbers or symbols." },
        ]}
      />
    </>
  );
}
