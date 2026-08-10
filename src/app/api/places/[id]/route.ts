import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../_supabaseAdmin";
import { requireUser, authErrorResponse } from "../../_auth";

// Edit or remove one saved place. Ownership is checked on every call;
// geofence_state rows cascade away with the place.

const KINDS = ["home", "school", "work", "lesson", "custom"] as const;

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { user } = await requireUser(req);
    const { id } = await ctx.params;
    const supabaseAdmin = getSupabaseAdmin();
    const body = await req.json();

    const updates: Record<string, unknown> = {};
    if (body.label !== undefined) {
      const clean = String(body.label).trim();
      if (!clean || clean.length > 60) {
        return NextResponse.json({ error: "Give the place a name" }, { status: 400 });
      }
      updates.label = clean;
    }
    if (body.kind !== undefined && KINDS.includes(body.kind)) updates.kind = body.kind;
    if (body.lat !== undefined && body.lng !== undefined) {
      if (
        typeof body.lat !== "number" ||
        typeof body.lng !== "number" ||
        Math.abs(body.lat) > 90 ||
        Math.abs(body.lng) > 180
      ) {
        return NextResponse.json({ error: "Pick a point on the map" }, { status: 400 });
      }
      updates.lat = body.lat;
      updates.lng = body.lng;
    }
    if (body.radiusM !== undefined) {
      updates.radius_m = Math.min(500, Math.max(100, Math.round(Number(body.radiusM) || 150)));
    }
    if (body.addressText !== undefined) {
      updates.address_text = body.addressText ? String(body.addressText).slice(0, 200) : null;
    }
    if (body.visibleToCircle !== undefined) updates.visible_to_circle = !!body.visibleToCircle;

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "Nothing to change" }, { status: 400 });
    }
    updates.updated_at = new Date().toISOString();

    const { data, error } = await supabaseAdmin
      .from("places")
      .update(updates)
      .eq("id", id)
      .eq("owner_user_id", user.id)
      .select()
      .maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data) return NextResponse.json({ error: "Place not found" }, { status: 404 });

    return NextResponse.json({ ok: true, place: data });
  } catch (error) {
    return (
      authErrorResponse(error) ??
      NextResponse.json({ error: "Could not update the place" }, { status: 500 })
    );
  }
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { user } = await requireUser(req);
    const { id } = await ctx.params;
    const supabaseAdmin = getSupabaseAdmin();

    const { data, error } = await supabaseAdmin
      .from("places")
      .delete()
      .eq("id", id)
      .eq("owner_user_id", user.id)
      .select("id")
      .maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data) return NextResponse.json({ error: "Place not found" }, { status: 404 });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return (
      authErrorResponse(error) ??
      NextResponse.json({ error: "Could not delete the place" }, { status: 500 })
    );
  }
}
