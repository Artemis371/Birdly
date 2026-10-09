import { json } from "@/lib/api-response";
import { readJson, requireAdmin } from "@/lib/auth/guard";
import { saveCustomMarket } from "@/lib/custom/admin-actions";

// Create a custom market (draft, or published straight away).
export async function POST(req: Request) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;
  const body = await readJson(req);
  const r = await saveCustomMarket(admin.id, null, body, body.publish === true);
  return r.ok ? json(r) : json(r, { status: 400 });
}
