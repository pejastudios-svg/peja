import { NextRequest, NextResponse } from "next/server";
import { requireUser, authErrorResponse } from "../../../_auth";
import { getSupabaseAdmin } from "../../../_supabaseAdmin";
import { getElectionActor, verifyElectionPin } from "../../../_electionAuth";
import { isRateLimitedDurable } from "../../../_rateLimit";

// Tally one sheet: an MVP (or admin) reads the photographed figures and
// enters votes per candidate. MVP-only by design: VIPs put evidence in,
// MVPs put numbers on it.
//
// Corrections are supersessions, never edits: a new tally row points the
// old one's superseded_by at itself, the old row stays public in the
// sheet's history, and only the latest row counts. Nothing here can be
// changed quietly.

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { user } = await requireUser(req);
    const { id: electionId } = await ctx.params;
    const supabaseAdmin = getSupabaseAdmin();
    const actor = await getElectionActor(supabaseAdmin, user.id);
    if (!actor.canTally) {
      return NextResponse.json({ error: "Tallying is for MVPs" }, { status: 403 });
    }
    if (await isRateLimitedDurable(`election-tally:${user.id}`, 120, 3600)) {
      return NextResponse.json({ error: "Too many tallies this hour." }, { status: 429 });
    }

    const { pin, uploadId, figures, note, deviceLat, deviceLng } = await req.json();
    const pinCheck = await verifyElectionPin(supabaseAdmin, actor, String(pin ?? ""));
    if (!pinCheck.ok) return NextResponse.json({ error: pinCheck.error }, { status: pinCheck.status });

    const { data: upload } = await supabaseAdmin
      .from("election_uploads")
      .select("id, election_id")
      .eq("id", uploadId)
      .eq("election_id", electionId)
      .maybeSingle();
    if (!upload) return NextResponse.json({ error: "Sheet not found" }, { status: 404 });

    // Figures must reference this election's real candidates, with sane
    // non-negative integers. Anything else is a typo or an attack.
    const { data: candidates } = await supabaseAdmin
      .from("election_candidates")
      .select("id")
      .eq("election_id", electionId);
    const validIds = new Set((candidates || []).map((c) => c.id));
    const cleanFigures: Record<string, number> = {};
    for (const [cid, raw] of Object.entries((figures as Record<string, unknown>) || {})) {
      if (!validIds.has(cid)) {
        return NextResponse.json({ error: "Unknown candidate in figures" }, { status: 400 });
      }
      const n = Number(raw);
      if (!Number.isInteger(n) || n < 0 || n > 10_000_000) {
        return NextResponse.json({ error: "Votes must be whole numbers" }, { status: 400 });
      }
      cleanFigures[cid] = n;
    }
    if (Object.keys(cleanFigures).length === 0) {
      return NextResponse.json({ error: "Enter at least one figure" }, { status: 400 });
    }

    // Current live tally for this sheet, if any: it gets superseded.
    const { data: live } = await supabaseAdmin
      .from("election_tallies")
      .select("id")
      .eq("upload_id", upload.id)
      .is("superseded_by", null)
      .maybeSingle();

    const { data: tally, error } = await supabaseAdmin
      .from("election_tallies")
      .insert({
        upload_id: upload.id,
        election_id: electionId,
        tallied_by: user.id,
        figures: cleanFigures,
        note: note ? String(note).trim().slice(0, 500) : null,
        device_lat: typeof deviceLat === "number" ? deviceLat : null,
        device_lng: typeof deviceLng === "number" ? deviceLng : null,
      })
      .select()
      .single();
    if (error || !tally) {
      return NextResponse.json({ error: "Could not save the tally" }, { status: 500 });
    }

    if (live) {
      await supabaseAdmin
        .from("election_tallies")
        .update({ superseded_by: tally.id })
        .eq("id", live.id);
    }

    return NextResponse.json({ ok: true, tally, corrected: !!live });
  } catch (error) {
    return (
      authErrorResponse(error) ?? NextResponse.json({ error: "Failed" }, { status: 500 })
    );
  }
}
