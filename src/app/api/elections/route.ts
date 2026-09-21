import { NextRequest, NextResponse } from "next/server";
import { requireUser, authErrorResponse } from "../_auth";
import { getSupabaseAdmin } from "../_supabaseAdmin";
import { getElectionActor, verifyElectionPin } from "../_electionAuth";
import { isRateLimitedDurable } from "../_rateLimit";

// Elections: list (any signed-in user) and create (VIP/MVP/admin + PIN).

export async function GET(req: NextRequest) {
  try {
    const { user } = await requireUser(req);
    const supabaseAdmin = getSupabaseAdmin();
    // For now: VIP/MVP/admin only. When the feature opens to all users,
    // drop this check (viewing was always meant to become public).
    const actorGate = await getElectionActor(supabaseAdmin, user.id);
    if (!actorGate.canWrite) {
      return NextResponse.json({ error: "Not available yet" }, { status: 403 });
    }

    const { data: elections } = await supabaseAdmin
      .from("elections")
      .select("id, title, description, cover_url, status, created_at")
      .order("created_at", { ascending: false });

    const ids = (elections || []).map((e) => e.id);
    let candidatesBy: Record<string, unknown[]> = {};
    let totalsBy: Record<string, Record<string, number>> = {};
    let uploadCountBy: Record<string, number> = {};

    if (ids.length > 0) {
      const [{ data: candidates }, { data: uploads }, totalsResults] = await Promise.all([
        supabaseAdmin
          .from("election_candidates")
          .select("id, election_id, name, description, photo_url, sort")
          .in("election_id", ids)
          .order("sort", { ascending: true }),
        supabaseAdmin
          .from("election_uploads")
          .select("election_id")
          .in("election_id", ids)
          .eq("hidden", false),
        // Postgres-side totals per election: bytes, not tally rows.
        Promise.all(
          ids.map((id) =>
            supabaseAdmin
              .rpc("election_totals", { p_election: id })
              .then(({ data }) => ({ id, rows: (data as { candidate_id: string; votes: number }[]) || [] })),
          ),
        ),
      ]);

      candidatesBy = {};
      for (const c of candidates || []) {
        (candidatesBy[c.election_id] ||= []).push(c);
      }
      totalsBy = {};
      for (const r of totalsResults) {
        const bucket: Record<string, number> = {};
        for (const row of r.rows) bucket[row.candidate_id] = Number(row.votes) || 0;
        totalsBy[r.id] = bucket;
      }
      uploadCountBy = {};
      for (const u of uploads || []) {
        uploadCountBy[u.election_id] = (uploadCountBy[u.election_id] || 0) + 1;
      }
    }

    return NextResponse.json({
      ok: true,
      elections: (elections || []).map((e) => ({
        ...e,
        candidates: candidatesBy[e.id] || [],
        totals: totalsBy[e.id] || {},
        uploadCount: uploadCountBy[e.id] || 0,
      })),
    });
  } catch (error) {
    return (
      authErrorResponse(error) ?? NextResponse.json({ error: "Failed" }, { status: 500 })
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const { user } = await requireUser(req);
    const supabaseAdmin = getSupabaseAdmin();
    const actor = await getElectionActor(supabaseAdmin, user.id);
    // Creation is the admin's alone.
    if (!actor.isAdmin) {
      return NextResponse.json({ error: "Only the admin creates elections" }, { status: 403 });
    }
    if (await isRateLimitedDurable(`election-create:${user.id}`, 10, 3600)) {
      return NextResponse.json({ error: "Too many elections created. Try later." }, { status: 429 });
    }

    const { pin, title, description } = await req.json();
    const pinCheck = await verifyElectionPin(supabaseAdmin, actor, String(pin ?? ""));
    if (!pinCheck.ok) return NextResponse.json({ error: pinCheck.error }, { status: pinCheck.status });

    const cleanTitle = String(title ?? "").trim();
    if (cleanTitle.length < 3 || cleanTitle.length > 120) {
      return NextResponse.json({ error: "Give the election a title" }, { status: 400 });
    }

    const { data: election, error } = await supabaseAdmin
      .from("elections")
      .insert({
        title: cleanTitle,
        description: description ? String(description).slice(0, 2000) : null,
        created_by: user.id,
      })
      .select()
      .single();
    if (error || !election) {
      return NextResponse.json({ error: "Could not create the election" }, { status: 500 });
    }

    return NextResponse.json({ ok: true, election });
  } catch (error) {
    return (
      authErrorResponse(error) ?? NextResponse.json({ error: "Failed" }, { status: 500 })
    );
  }
}
