import { json } from "@/lib/api-response";
import { listUsers } from "@/lib/admin";
import { requireAdmin } from "@/lib/auth/guard";

export async function GET() {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;
  return json({ users: await listUsers() });
}
