import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../../_supabaseAdmin";
import { requireUser } from "../../../_auth";

export const runtime = "nodejs";

// face-api recommends 0.5 as the Euclidean distance threshold between
// 128-D descriptors. Same-face distances typically land in 0.3–0.4,
// different-face in 0.6+. We log the actual min distance on every
// attempt so we can tune later if false rejects creep in.
const MATCH_THRESHOLD = 0.5;

function euclidean(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    sum += d * d;
  }
  return Math.sqrt(sum);
}

function ipFrom(req: NextRequest): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown"
  );
}

export async function POST(req: NextRequest) {
  try {
    const { user } = await requireUser(req);
    const supabaseAdmin = getSupabaseAdmin();

    const { data: adminCheck } = await supabaseAdmin
      .from("users")
      .select("is_admin")
      .eq("id", user.id)
      .single();

    if (!adminCheck?.is_admin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await req.json().catch(() => null);
    if (!body) return NextResponse.json({ error: "Invalid body" }, { status: 400 });

    const { descriptor } = body as { descriptor?: unknown };
    if (!Array.isArray(descriptor) || descriptor.length !== 128) {
      return NextResponse.json({ error: "descriptor must be a 128-float array" }, { status: 400 });
    }
    if (!descriptor.every((v) => typeof v === "number" && Number.isFinite(v))) {
      return NextResponse.json({ error: "descriptor contains invalid values" }, { status: 400 });
    }

    const { data: enrollments, error: fetchErr } = await supabaseAdmin
      .from("admin_face_enrollments")
      .select("id, label, descriptor")
      .eq("user_id", user.id)
      .is("revoked_at", null);

    if (fetchErr) {
      return NextResponse.json({ error: fetchErr.message }, { status: 500 });
    }
    if (!enrollments || enrollments.length === 0) {
      return NextResponse.json(
        { ok: false, reason: "no_enrollments", error: "No enrolled faces" },
        { status: 400 }
      );
    }

    let bestDistance = Infinity;
    let bestId: string | null = null;
    let bestLabel: string | null = null;
    for (const e of enrollments) {
      const stored = e.descriptor as unknown;
      if (!Array.isArray(stored) || stored.length !== 128) continue;
      const d = euclidean(descriptor as number[], stored as number[]);
      if (d < bestDistance) {
        bestDistance = d;
        bestId = e.id;
        bestLabel = e.label;
      }
    }

    const matched = bestDistance < MATCH_THRESHOLD;

    await supabaseAdmin.from("admin_access_log").insert({
      user_id: user.id,
      action: matched ? "face_verify_success" : "face_verify_fail",
      ip_address: ipFrom(req),
      user_agent: req.headers.get("user-agent") || "unknown",
      metadata: {
        distance: Number(bestDistance.toFixed(4)),
        threshold: MATCH_THRESHOLD,
        matched_enrollment_id: matched ? bestId : null,
        matched_label: matched ? bestLabel : null,
        candidates_count: enrollments.length,
      },
    });

    if (!matched) {
      return NextResponse.json({
        ok: false,
        distance: Number(bestDistance.toFixed(4)),
        threshold: MATCH_THRESHOLD,
      });
    }

    return NextResponse.json({
      ok: true,
      distance: Number(bestDistance.toFixed(4)),
      threshold: MATCH_THRESHOLD,
      matchedEnrollmentId: bestId,
      matchedLabel: bestLabel,
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Server error";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
