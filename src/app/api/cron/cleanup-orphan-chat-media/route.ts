import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../_supabaseAdmin";

// Periodic cleanup for chat media in Supabase Storage that has no
// matching `message_media` row. Runs through the Storage API (NOT raw
// SQL) because the `storage.objects` table has a `protect_delete()`
// trigger that blocks direct DELETEs to avoid corrupting the bucket's
// internal accounting.
//
// Auth pattern matches the other cron routes here:
//   • Authorization: Bearer <CRON_SECRET>     (preferred)
//   • ?secret=<CRON_SECRET>                   (fallback, for cron
//                                              services whose free
//                                              tier strips headers)
//
// Triggers it's expected to handle:
//   • User cancelled an in-flight Supabase Storage upload. Client
//     state was torn down but bytes finished uploading (JS client
//     doesn't honour AbortSignal for storage uploads yet). Result is
//     an orphan.
//   • A `messages` insert failed (e.g. RLS) after the storage upload
//     succeeded.
//   • Anything else that left a file behind without a matching media
//     row.
//
// Safety rails:
//   • One-hour grace window — never deletes objects newer than this
//     so a slow upload still in flight can't be deleted out from
//     under itself.
//   • Strict bucket scope — only `message-media`.

export const runtime = "nodejs";
export const maxDuration = 60;

const BUCKET = "message-media";
const GRACE_MS = 60 * 60 * 1000; // 1 hour

export async function GET(req: NextRequest) {
  return handle(req);
}
export async function POST(req: NextRequest) {
  return handle(req);
}

async function handle(req: NextRequest) {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return NextResponse.json(
      { ok: false, error: "CRON_SECRET not configured" },
      { status: 500 }
    );
  }
  const authHeader = req.headers.get("authorization");
  const queryToken = req.nextUrl.searchParams.get("secret");
  const authorized =
    authHeader === `Bearer ${expected}` || queryToken === expected;
  if (!authorized) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  try {
    const supabase = getSupabaseAdmin();

    // 1. Pull every storage row in the bucket older than the grace
    //    window. Service-role can SELECT storage.objects freely; only
    //    DELETE is gated by protect_delete.
    const cutoffIso = new Date(Date.now() - GRACE_MS).toISOString();
    const { data: candidates, error: queryErr } = await supabase
      .schema("storage")
      .from("objects")
      .select("id, name, created_at")
      .eq("bucket_id", BUCKET)
      .lt("created_at", cutoffIso)
      .limit(5000);
    if (queryErr) throw queryErr;

    const candidateNames = (candidates || []).map((c) => c.name as string);
    if (candidateNames.length === 0) {
      return NextResponse.json({ ok: true, scanned: 0, deleted: 0 });
    }

    // 2. Find every message_media URL once, set-diff in memory.
    //    Individual `LIKE %name%` queries per candidate would thrash
    //    the DB at scale.
    const { data: aliveRows, error: mediaErr } = await supabase
      .from("message_media")
      .select("url");
    if (mediaErr) throw mediaErr;

    // Build a set of "alive" path tails. A media URL looks like:
    //   https://<project>.supabase.co/storage/v1/object/public/message-media/<path>
    // and storage.objects.name is `<path>`. The path is the trailing
    // segment after `message-media/`.
    const aliveNames = new Set<string>();
    for (const row of (aliveRows || []) as Array<{ url: string }>) {
      const idx = row.url.indexOf(`/${BUCKET}/`);
      if (idx === -1) continue;
      aliveNames.add(row.url.slice(idx + BUCKET.length + 2));
    }

    const orphans = candidateNames.filter((n) => !aliveNames.has(n));

    if (orphans.length === 0) {
      return NextResponse.json({
        ok: true,
        scanned: candidateNames.length,
        deleted: 0,
      });
    }

    // 3. Delete via the Storage API (NOT raw SQL — protect_delete).
    //    Storage API removes the file from its backend AND removes
    //    the `storage.objects` row via its privileged service path.
    //    Batches of 100 to stay under request payload limits.
    let deleted = 0;
    const errors: string[] = [];
    for (let i = 0; i < orphans.length; i += 100) {
      const batch = orphans.slice(i, i + 100);
      const { error: removeErr } = await supabase.storage
        .from(BUCKET)
        .remove(batch);
      if (removeErr) {
        errors.push(removeErr.message);
        continue;
      }
      deleted += batch.length;
    }

    return NextResponse.json({
      ok: errors.length === 0,
      scanned: candidateNames.length,
      orphans_found: orphans.length,
      deleted,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[cron/cleanup-orphan-chat-media]", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
