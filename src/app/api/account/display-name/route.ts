import { json } from "@/lib/api-response";
import { readJson, requireUser } from "@/lib/auth/guard";
import { validateDisplayName } from "@/lib/auth/validation";
import { adminClient } from "@/lib/supabase/admin";

export async function POST(req: Request) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const name = validateDisplayName((await readJson(req)).displayName);
  if (!name.ok) return json({ error: name.error }, { status: 400 });
  const { error } = await adminClient().rpc("set_display_name", { p_user_id: user.id, p_display_name: name.value });
  if (error) {
    if (error.code === "23505") return json({ error: "That display name is taken. Try another one." }, { status: 409 });
    console.error("[display-name]", error.message);
    return json({ error: "Couldn't save that. Try again." }, { status: 500 });
  }
  return json({ ok: true, displayName: name.value });
}
