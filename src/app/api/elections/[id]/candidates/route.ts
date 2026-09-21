import { NextRequest, NextResponse } from "next/server";
import { requireUser, authErrorResponse } from "../../../_auth";
import { getSupabaseAdmin } from "../../../_supabaseAdmin";
import { getElectionActor, verifyElectionPin } from "../../../_electionAuth";
import { isRateLimitedDurable } from "../../../_rateLimit";

// Add a candidate to an election (VIP/MVP/admin + PIN). No limit on how
// many: as many people run, that many rows. Candidates are append-only
// like everything else here; a mistake is corrected by the admin, in the
// open, not silently edited.

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { user } = await requireUser(req);
    const { id: electionId } = await ctx.params;
    const supabaseAdmin = getSupabaseAdmin();
    const actor = await getElectionActor(supabaseAdmin, user.id);
    // Candidates are the admin's alone to add.
    if (!actor.isAdmin) {
      return NextResponse.json({ error: "Only the admin adds candidates" }, { status: 403 });
    }
    if (await isRateLimitedDurable(`election-candidate:${user.id}`, 60, 3600)) {
      return NextResponse.json({ error: "Too many additions. Try later." }, { status: 429 });
    }

    const { pin, name, description, photoDataUrl } = await req.json();
    const pinCheck = await verifyElectionPin(supabaseAdmin, actor, String(pin ?? ""));
    if (!pinCheck.ok) return NextResponse.json({ error: pinCheck.error }, { status: pinCheck.status });

    const { data: election } = await supabaseAdmin
      .from("elections")
      .select("id, status")
      .eq("id", electionId)
      .maybeSingle();
    if (!election) return NextResponse.json({ error: "Election not found" }, { status: 404 });
    if (election.status !== "active") {
      return NextResponse.json({ error: "This election is closed" }, { status: 400 });
    }

    const cleanName = String(name ?? "").trim();
    if (cleanName.length < 2 || cleanName.length > 120) {
      return NextResponse.json({ error: "Give the candidate a name" }, { status: 400 });
    }

    // Optional profile photo, stored under the immutable elections prefix.
    let photoUrl: string | null = null;
    if (photoDataUrl) {
      const m = /^data:image\/(jpeg|jpg|png|webp);base64,(.+)$/.exec(String(photoDataUrl));
      if (!m) return NextResponse.json({ error: "Bad image" }, { status: 400 });
      const bytes = Buffer.from(m[2], "base64");
      if (bytes.length > 5 * 1024 * 1024) {
        return NextResponse.json({ error: "Image too large (5MB max)" }, { status: 400 });
      }
      const path = `elections/${electionId}/candidates/${crypto.randomUUID()}.${m[1] === "png" ? "png" : m[1] === "webp" ? "webp" : "jpg"}`;
      const { error: upErr } = await supabaseAdmin.storage
        .from("media")
        .upload(path, bytes, { contentType: `image/${m[1] === "jpg" ? "jpeg" : m[1]}` });
      if (upErr) return NextResponse.json({ error: "Could not store the image" }, { status: 500 });
      photoUrl = supabaseAdmin.storage.from("media").getPublicUrl(path).data.publicUrl;
    }

    const { count } = await supabaseAdmin
      .from("election_candidates")
      .select("id", { count: "exact", head: true })
      .eq("election_id", electionId);

    const { data: candidate, error } = await supabaseAdmin
      .from("election_candidates")
      .insert({
        election_id: electionId,
        name: cleanName,
        description: description ? String(description).slice(0, 1000) : null,
        photo_url: photoUrl,
        created_by: user.id,
        sort: count ?? 0,
      })
      .select()
      .single();
    if (error || !candidate) {
      return NextResponse.json({ error: "Could not add the candidate" }, { status: 500 });
    }

    return NextResponse.json({ ok: true, candidate });
  } catch (error) {
    return (
      authErrorResponse(error) ?? NextResponse.json({ error: "Failed" }, { status: 500 })
    );
  }
}
