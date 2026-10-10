import { json } from "@/lib/api-response";
import { readJson, requireAdmin } from "@/lib/auth/guard";
import { friendly } from "@/lib/custom/admin-actions";
import { categorySlug } from "@/lib/custom/chips";
import { adminClient } from "@/lib/supabase/admin";

// Admin only. actions: create { label } | rename { id, label } | reorder { ids }
export async function POST(req: Request) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;
  const body = await readJson(req);
  const db = adminClient();

  if (body.action === "create" || body.action === "rename") {
    const c = categorySlug(typeof body.label === "string" ? body.label : "");
    if (!c.ok) return json({ error: c.error }, { status: 400 });
    if (body.action === "create") {
      const { data, error } = await db.rpc("admin_create_custom_category", { p_admin_id: admin.id, p_slug: c.slug, p_label: c.label });
      return error ? json({ error: friendly(error.message) }, { status: 400 }) : json({ ok: true, id: data });
    }
    const id = Number(body.id);
    if (!Number.isInteger(id) || id <= 0) return json({ error: "That category wasn't found." }, { status: 400 });
    const { error } = await db.rpc("admin_rename_custom_category", { p_admin_id: admin.id, p_id: id, p_label: c.label });
    return error ? json({ error: friendly(error.message) }, { status: 400 }) : json({ ok: true });
  }
  if (body.action === "reorder") {
    const ids = Array.isArray(body.ids) ? body.ids.map(Number) : [];
    if (!ids.length || ids.length > 50 || !ids.every((n) => Number.isInteger(n) && n > 0)) return json({ error: "That order doesn't look right." }, { status: 400 });
    const { error } = await db.rpc("admin_reorder_custom_categories", { p_admin_id: admin.id, p_ids: ids });
    return error ? json({ error: friendly(error.message) }, { status: 400 }) : json({ ok: true });
  }
  return json({ error: "Unknown action." }, { status: 400 });
}
