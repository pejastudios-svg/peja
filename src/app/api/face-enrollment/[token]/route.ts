import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../_supabaseAdmin";

export const runtime = "nodejs";

// Public routes — no admin auth required, since the whole point of an
// enrollment link is that the recipient can open it without already
// having credentials. The token itself is the credential. We validate
// it server-side on every call and burn it on first successful enroll.

type RouteCtx = { params: Promise<{ token: string }> };

function ipFrom(req: NextRequest): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown"
  );
}

// GET: check whether a token is still valid and return the target's
// display info so the enrollment page can greet the right person.
export async function GET(req: NextRequest, ctx: RouteCtx) {
  try {
    const { token } = await ctx.params;
    if (!token) return NextResponse.json({ error: "Missing token" }, { status: 400 });

    const supabaseAdmin = getSupabaseAdmin();
    const { data: row, error } = await supabaseAdmin
      .from("admin_face_enrollment_tokens")
      .select("token, user_id, label_hint, expires_at, used_at, revoked_at")
      .eq("token", token)
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (!row) {
      return NextResponse.json({ ok: false, reason: "not_found" }, { status: 404 });
    }
    if (row.used_at) {
      return NextResponse.json({ ok: false, reason: "already_used" }, { status: 410 });
    }
    if (row.revoked_at) {
      return NextResponse.json({ ok: false, reason: "revoked" }, { status: 410 });
    }
    if (new Date(row.expires_at).getTime() < Date.now()) {
      return NextResponse.json({ ok: false, reason: "expired" }, { status: 410 });
    }

    const { data: target } = await supabaseAdmin
      .from("users")
      .select("email, full_name")
      .eq("id", row.user_id)
      .single();

    return NextResponse.json({
      ok: true,
      labelHint: row.label_hint,
      expiresAt: row.expires_at,
      target: { email: target?.email, fullName: target?.full_name },
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Server error";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

// POST: submit the captured descriptor. The token is re-validated and
// then burned in a single update so a race between two browsers using
// the same link can't double-enroll. Returns the new enrollment row.
export async function POST(req: NextRequest, ctx: RouteCtx) {
  try {
    const { token } = await ctx.params;
    if (!token) return NextResponse.json({ error: "Missing token" }, { status: 400 });

    const body = await req.json().catch(() => null);
    if (!body) return NextResponse.json({ error: "Invalid body" }, { status: 400 });

    const { descriptor, label, thumbnail } = body as {
      descriptor?: unknown;
      label?: unknown;
      thumbnail?: unknown;
    };

    if (!Array.isArray(descriptor) || descriptor.length !== 128) {
      return NextResponse.json({ error: "descriptor must be a 128-float array" }, { status: 400 });
    }
    if (!descriptor.every((v) => typeof v === "number" && Number.isFinite(v))) {
      return NextResponse.json({ error: "descriptor contains invalid values" }, { status: 400 });
    }
    const trimmedLabel = typeof label === "string" ? label.trim().slice(0, 60) : "";
    if (!trimmedLabel) {
      return NextResponse.json({ error: "label required" }, { status: 400 });
    }

    const supabaseAdmin = getSupabaseAdmin();

    // Re-validate the token. We don't trust the GET response.
    const { data: row, error: tokErr } = await supabaseAdmin
      .from("admin_face_enrollment_tokens")
      .select("token, user_id, created_by, expires_at, used_at, revoked_at")
      .eq("token", token)
      .maybeSingle();
    if (tokErr) return NextResponse.json({ error: tokErr.message }, { status: 500 });
    if (!row) return NextResponse.json({ ok: false, reason: "not_found" }, { status: 404 });
    if (row.used_at) return NextResponse.json({ ok: false, reason: "already_used" }, { status: 410 });
    if (row.revoked_at) return NextResponse.json({ ok: false, reason: "revoked" }, { status: 410 });
    if (new Date(row.expires_at).getTime() < Date.now()) {
      return NextResponse.json({ ok: false, reason: "expired" }, { status: 410 });
    }

    // Optional: upload the baseline thumbnail to Cloudinary so admins
    // can audit which face was enrolled. Skipped silently if Cloudinary
    // env vars aren't set.
    let thumbnailUrl: string | null = null;
    if (typeof thumbnail === "string" && thumbnail.startsWith("data:image/")) {
      const cloudName = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
      const apiKey = process.env.CLOUDINARY_API_KEY;
      const apiSecret = process.env.CLOUDINARY_API_SECRET;
      if (cloudName && apiKey && apiSecret) {
        try {
          const { createHash } = await import("crypto");
          const timestamp = Math.floor(Date.now() / 1000).toString();
          const folder = "peja-face-enrollments";
          const sig = createHash("sha1")
            .update(`folder=${folder}&timestamp=${timestamp}${apiSecret}`)
            .digest("hex");
          const form = new FormData();
          form.append("file", thumbnail);
          form.append("folder", folder);
          form.append("timestamp", timestamp);
          form.append("api_key", apiKey);
          form.append("signature", sig);
          const up = await fetch(
            `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`,
            { method: "POST", body: form }
          );
          if (up.ok) {
            const d = await up.json();
            thumbnailUrl = d.secure_url || null;
          }
        } catch {
          // Non-fatal: enrollment still succeeds without a thumbnail.
        }
      }
    }

    const { data: inserted, error: insertErr } = await supabaseAdmin
      .from("admin_face_enrollments")
      .insert({
        user_id: row.user_id,
        label: trimmedLabel,
        descriptor,
        thumbnail_url: thumbnailUrl,
        enrolled_by: row.created_by,
      })
      .select("id, label, enrolled_at, thumbnail_url")
      .single();

    if (insertErr || !inserted) {
      return NextResponse.json(
        { error: insertErr?.message || "Insert failed" },
        { status: 500 }
      );
    }

    // Burn the token. The where-clause re-checks used_at to lose the
    // race politely if another browser got here first.
    const { error: burnErr } = await supabaseAdmin
      .from("admin_face_enrollment_tokens")
      .update({ used_at: new Date().toISOString(), used_enrollment_id: inserted.id })
      .eq("token", token)
      .is("used_at", null);
    if (burnErr) {
      // Best-effort: clean up the orphan enrollment if the burn fails.
      await supabaseAdmin.from("admin_face_enrollments").delete().eq("id", inserted.id);
      return NextResponse.json({ error: burnErr.message }, { status: 500 });
    }

    await supabaseAdmin.from("admin_access_log").insert({
      user_id: row.user_id,
      action: "face_enrolled",
      ip_address: ipFrom(req),
      user_agent: req.headers.get("user-agent") || "unknown",
      metadata: { enrollment_id: inserted.id, label: trimmedLabel, via_token: token },
    });

    return NextResponse.json({ ok: true, enrollment: inserted });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Server error";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
