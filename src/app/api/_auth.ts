import { NextRequest } from "next/server";
import { getSupabaseAdmin } from "./_supabaseAdmin";

export async function requireUser(req: NextRequest) {
  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;

  if (!token) throw new Error("Missing Authorization token");

  const supabaseAdmin = getSupabaseAdmin();
  const { data, error } = await supabaseAdmin.auth.getUser(token);

  if (error || !data.user) throw new Error("Invalid user");

  return { user: data.user };
}

export async function requireAdmin(req: NextRequest) {
  const { user } = await requireUser(req);
  const supabaseAdmin = getSupabaseAdmin();

  const { data, error } = await supabaseAdmin
    .from("users")
    .select("is_admin")
    .eq("id", user.id)
    .single();

  if (error || !data?.is_admin) throw new Error("Admin required");
  return { user };
}