import { NextRequest, NextResponse } from "next/server";
import { requireUser, authErrorResponse } from "../../../_auth";
import { getSupabaseAdmin } from "../../../_supabaseAdmin";
import { getElectionActor } from "../../../_electionAuth";

// The transparency read: totals and evidence for one election, optionally
// narrowed to a state or an LGA. Any signed-in user. The photos and the
// figures travel together on purpose: the entire point is that a viewer
// can check the arithmetic against the evidence themselves.
//
// Hidden sheets come back as stubs: the photo is withheld, the reason is
// shown, the row is never pretended away. Their figures are excluded
// from totals.

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { user } = await requireUser(req);
    const { id: electionId } = await ctx.params;
    const supabaseAdmin = getSupabaseAdmin();
    // For now: VIP/MVP/admin only, same gate as the list route.
    const actorGate = await getElectionActor(supabaseAdmin, user.id);
    if (!actorGate.canWrite) {
      return NextResponse.json({ error: "Not available yet" }, { status: 403 });
    }
    // Who uploaded and who tallied is working information for the people
    // doing the work, not for the audience: MVPs and the admin see names,
    // everyone else sees the evidence and the arithmetic anonymously.
    const revealIdentities = actorGate.canTally;

    const state = req.nextUrl.searchParams.get("state");
    const lga = req.nextUrl.searchParams.get("lga");

    const [{ data: election }, { data: candidates }] = await Promise.all([
      supabaseAdmin
        .from("elections")
        .select("id, title, description, cover_url, status, created_at")
        .eq("id", electionId)
        .maybeSingle(),
      supabaseAdmin
        .from("election_candidates")
        .select("id, name, description, photo_url, sort")
        .eq("election_id", electionId)
        .order("sort", { ascending: true }),
    ]);
    if (!election) return NextResponse.json({ error: "Election not found" }, { status: 404 });

    let uploadsQuery = supabaseAdmin
      .from("election_uploads")
      .select(
        "id, state, lga, polling_unit, photo_url, photo_sha256, hidden, hidden_reason, tallies_hidden, created_at, uploader_id, users:uploader_id (full_name)",
      )
      .eq("election_id", electionId)
      .order("created_at", { ascending: false })
      .limit(500);
    if (state) uploadsQuery = uploadsQuery.eq("state", state);
    if (lga) uploadsQuery = uploadsQuery.eq("lga", lga);
    const { data: uploads } = await uploadsQuery;

    const uploadIds = (uploads || []).map((u) => u.id);
    let talliesBy: Record<string, unknown> = {};
    if (uploadIds.length > 0) {
      const { data: tallies } = await supabaseAdmin
        .from("election_tallies")
        .select("id, upload_id, figures, note, created_at, superseded_by, users:tallied_by (full_name)")
        .in("upload_id", uploadIds)
        .order("created_at", { ascending: false });
      talliesBy = {};
      for (const t of tallies || []) {
        ((talliesBy as Record<string, unknown[]>)[t.upload_id] ||= []).push({
          id: t.id,
          figures: t.figures,
          note: t.note,
          createdAt: t.created_at,
          superseded: !!t.superseded_by,
          talliedBy: revealIdentities
            ? (t as { users?: { full_name?: string } }).users?.full_name || "MVP"
            : null,
        });
      }
    }

    // Totals and the geo index come from Postgres aggregates, never row
    // pulls: a national election must cost a refresh a few hundred bytes.
    const [{ data: totalRows }, { data: geoRows }] = await Promise.all([
      supabaseAdmin.rpc("election_totals_scoped", {
        p_election: electionId,
        p_state: state || null,
        p_lga: lga || null,
      }),
      supabaseAdmin.rpc("election_geo_index", { p_election: electionId }),
    ]);
    const totals: Record<string, number> = {};
    for (const r of (totalRows as { candidate_id: string; votes: number }[]) || []) {
      totals[r.candidate_id] = Number(r.votes) || 0;
    }
    const geoIndex: Record<string, Record<string, number>> = {};
    for (const g of (geoRows as { state: string; lga: string; sheet_count: number }[]) || []) {
      (geoIndex[g.state] ||= {})[g.lga] = Number(g.sheet_count) || 0;
    }

    return NextResponse.json({
      ok: true,
      election,
      candidates: candidates || [],
      totals,
      geoIndex,
      uploads: (uploads || []).map((u) =>
        u.hidden
          ? {
              // Hidden evidence: the record exists in its state and LGA,
              // with the reason, and NOTHING else. No photo, no uploader,
              // no polling unit, no fingerprint, no tally details.
              id: u.id,
              state: u.state,
              lga: u.lga,
              pollingUnit: null,
              photoUrl: null,
              sha256: "",
              hidden: true,
              hiddenReason: u.hidden_reason || "Under review",
              createdAt: u.created_at,
              uploaderName: null,
              tallies: [],
            }
          : {
              id: u.id,
              state: u.state,
              lga: u.lga,
              pollingUnit: u.polling_unit,
              photoUrl: u.photo_url,
              sha256: u.photo_sha256,
              hidden: false,
              hiddenReason: null,
              createdAt: u.created_at,
              uploaderName: revealIdentities
                ? (u as { users?: { full_name?: string } }).users?.full_name || "VIP"
                : null,
              tallies: (talliesBy as Record<string, unknown[]>)[u.id] || [],
            },
      ),
    });
  } catch (error) {
    return (
      authErrorResponse(error) ?? NextResponse.json({ error: "Failed" }, { status: 500 })
    );
  }
}
