import { NextRequest, NextResponse } from "next/server";
import { createHash, randomUUID } from "crypto";
import { requireUser, authErrorResponse } from "../../../_auth";
import { getSupabaseAdmin } from "../../../_supabaseAdmin";
import { getElectionActor, verifyElectionPin } from "../../../_electionAuth";
import { isRateLimitedDurable } from "../../../_rateLimit";
import { NIGERIA_LGAS } from "@/lib/nigeriaLgas";

// Upload one photographed result sheet. VIP/MVP/admin + PIN.
//
// THE moment of permanence: before this request the photo is the
// uploader's to retake or discard; after a 200 from here it belongs to
// the record, forever. There is no update route, no delete route, and
// the storage prefix is write-locked to the service role. We also
// fingerprint the exact bytes (SHA-256) into the ledger row, and record
// where the uploading phone physically was, so a sheet claimed from one
// LGA but sent from another carries its own contradiction.

export const maxDuration = 60;

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { user } = await requireUser(req);
    const { id: electionId } = await ctx.params;
    const supabaseAdmin = getSupabaseAdmin();
    const actor = await getElectionActor(supabaseAdmin, user.id);
    if (!actor.canWrite) {
      return NextResponse.json({ error: "Not available on this account" }, { status: 403 });
    }
    // 30 sheets an hour is a very busy polling agent; more is a script.
    if (await isRateLimitedDurable(`election-upload:${user.id}`, 30, 3600)) {
      return NextResponse.json({ error: "Too many uploads this hour." }, { status: 429 });
    }

    const body = await req.json();
    const pinCheck = await verifyElectionPin(supabaseAdmin, actor, String(body.pin ?? ""));
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

    // Geography must be real: the claimed state and LGA have to exist and
    // match each other, or the browse drill-down would grow ghost rows.
    const state = String(body.state ?? "").trim();
    const lga = String(body.lga ?? "").trim();
    if (!NIGERIA_LGAS[state]) {
      return NextResponse.json({ error: "Pick a valid state" }, { status: 400 });
    }
    if (!NIGERIA_LGAS[state].includes(lga)) {
      return NextResponse.json({ error: "Pick a valid LGA for that state" }, { status: 400 });
    }

    // Two ways in, one destination.
    //  - tempPath: the photo was already silently pre-uploaded to temp/
    //    while the uploader was still filling the form. Commit = a
    //    server-side MOVE into the sealed elections/ prefix, so the
    //    moment-of-truth request is tiny and survives election-day
    //    networks. The path must be the caller's own temp file.
    //  - photoDataUrl: the fallback (pre-upload failed, or the offline
    //    outbox replaying a queued sheet with the bytes inline).
    let bytes: Buffer;
    let path: string;
    let contentType: string;

    if (body.tempPath) {
      const tempPath = String(body.tempPath);
      if (!/^temp\/[A-Za-z0-9-]+-\d+-[a-z0-9]+\.(jpg|jpeg|png|webp)$/.test(tempPath) ||
          !tempPath.startsWith(`temp/${user.id}-`)) {
        return NextResponse.json({ error: "Bad photo reference" }, { status: 400 });
      }
      const { data: blob, error: dlErr } = await supabaseAdmin.storage
        .from("media")
        .download(tempPath);
      if (dlErr || !blob) {
        return NextResponse.json(
          { error: "That photo is no longer staged. Retake it." },
          { status: 400 },
        );
      }
      bytes = Buffer.from(await blob.arrayBuffer());
      contentType = blob.type || "image/jpeg";
      const ext = tempPath.split(".").pop() || "jpg";
      path = `elections/${electionId}/sheets/${randomUUID()}.${ext}`;
    } else {
      const m = /^data:image\/(jpeg|jpg|png|webp);base64,(.+)$/.exec(String(body.photoDataUrl ?? ""));
      if (!m) return NextResponse.json({ error: "No photo attached" }, { status: 400 });
      bytes = Buffer.from(m[2], "base64");
      contentType = `image/${m[1] === "jpg" ? "jpeg" : m[1]}`;
      const ext = m[1] === "png" ? "png" : m[1] === "webp" ? "webp" : "jpg";
      path = `elections/${electionId}/sheets/${randomUUID()}.${ext}`;
    }

    if (bytes.length < 10_000) {
      return NextResponse.json({ error: "That photo looks empty. Retake it." }, { status: 400 });
    }
    if (bytes.length > 12 * 1024 * 1024) {
      return NextResponse.json({ error: "Photo too large (12MB max)" }, { status: 400 });
    }

    // The ledger fingerprints the exact bytes that get sealed.
    const sha256 = createHash("sha256").update(bytes).digest("hex");

    if (body.tempPath) {
      const { error: mvErr } = await supabaseAdmin.storage
        .from("media")
        .move(String(body.tempPath), path);
      if (mvErr) {
        console.error("[elections/upload] move failed:", mvErr.message);
        return NextResponse.json({ error: "Could not store the photo. Try again." }, { status: 500 });
      }
    } else {
      const { error: upErr } = await supabaseAdmin.storage
        .from("media")
        .upload(path, bytes, { contentType });
      if (upErr) {
        console.error("[elections/upload] storage failed:", upErr.message);
        return NextResponse.json({ error: "Could not store the photo. Try again." }, { status: 500 });
      }
    }
    const photoUrl = supabaseAdmin.storage.from("media").getPublicUrl(path).data.publicUrl;

    const deviceLat = typeof body.deviceLat === "number" ? body.deviceLat : null;
    const deviceLng = typeof body.deviceLng === "number" ? body.deviceLng : null;

    const { data: upload, error } = await supabaseAdmin
      .from("election_uploads")
      .insert({
        election_id: electionId,
        uploader_id: user.id,
        state,
        lga,
        polling_unit: body.pollingUnit ? String(body.pollingUnit).trim().slice(0, 120) : null,
        photo_url: photoUrl,
        photo_sha256: sha256,
        device_lat: deviceLat,
        device_lng: deviceLng,
        device_accuracy_m:
          typeof body.deviceAccuracyM === "number" ? Math.round(body.deviceAccuracyM) : null,
      })
      .select()
      .single();
    if (error || !upload) {
      return NextResponse.json({ error: "Could not record the upload" }, { status: 500 });
    }

    return NextResponse.json({ ok: true, upload });
  } catch (error) {
    return (
      authErrorResponse(error) ?? NextResponse.json({ error: "Failed" }, { status: 500 })
    );
  }
}
