import { NextRequest, NextResponse } from "next/server";
import { createHash, randomBytes } from "crypto";
import { getSupabaseAdmin } from "../../_supabaseAdmin";
import { requireUser, authErrorResponse } from "../../_auth";

// Mint (POST) or revoke (DELETE) the device tracking key that the native
// ambient-location service uses to authenticate beats. One key per user;
// minting again rotates it (old one stops working immediately). The raw
// secret is returned ONCE and only its hash is stored.

export async function POST(req: NextRequest) {
  try {
    const { user } = await requireUser(req);
    const supabaseAdmin = getSupabaseAdmin();

    const secret = "pbk_" + randomBytes(24).toString("hex");
    const hash = createHash("sha256").update(secret).digest("hex");

    const { error } = await supabaseAdmin.from("device_tracking_keys").upsert({
      user_id: user.id,
      secret_hash: hash,
      created_at: new Date().toISOString(),
      last_used_at: null,
      revoked_at: null,
    });
    if (error) {
      console.error("[tracker-key] mint failed:", error.message);
      return NextResponse.json({ error: "Could not set up background tracking" }, { status: 500 });
    }
    return NextResponse.json({ key: secret });
  } catch (error) {
    return (
      authErrorResponse(error) ??
      NextResponse.json({ error: "Something went wrong" }, { status: 500 })
    );
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { user } = await requireUser(req);
    const supabaseAdmin = getSupabaseAdmin();
    await supabaseAdmin
      .from("device_tracking_keys")
      .update({ revoked_at: new Date().toISOString() })
      .eq("user_id", user.id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return (
      authErrorResponse(error) ??
      NextResponse.json({ error: "Something went wrong" }, { status: 500 })
    );
  }
}
