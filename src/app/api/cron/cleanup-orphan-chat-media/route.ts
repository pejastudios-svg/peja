import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../_supabaseAdmin";

// Periodic cleanup for chat media in Supabase Storage that has no
// matching `message_media` row.
//
// Auth pattern matches the other cron routes here:
//   • Authorization: Bearer <CRON_SECRET>     (preferred)
//   • ?secret=<CRON_SECRET>                   (fallback, for cron
//                                              services whose free
//                                              tier strips headers)
//
// Two-step pattern:
//   1. Call peja_list_orphan_chat_media() (SECURITY DEFINER) — it
//      returns the list of orphan paths. We can't query
//      storage.objects directly via PostgREST because Supabase
//      doesn't expose the storage schema there.
//   2. Pass those paths to supabase.storage.from(BUCKET).remove(...)
//      which goes through the Storage API. Storage API is the path
//      that respects Supabase's protect_delete trigger AND maintains
//      bucket size accounting — raw SQL DELETE on storage.objects
//      would error out.
//
// Safety rails:
//   • One-hour grace window — never touches objects newer than this
//     so a slow upload still in flight can't be deleted out from
//     under itself.
//   • Strict bucket scope — only `message-media`.

export const runtime = "nodejs";
export const maxDuration = 60;

const BUCKET = "message-media";
const GRACE_MINUTES = 60;

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

    // 1. List orphans via the SECURITY DEFINER function.
    const { data: orphans, error: listErr } = await supabase.rpc(
      "peja_list_orphan_chat_media",
      { grace_minutes: GRACE_MINUTES }
    );
    if (listErr) {
      // Surface the actual Supabase error rather than letting it
      // serialize as "[object Object]" — that's what bit the previous
      // version.
      return NextResponse.json(
        {
          ok: false,
          stage: "list",
          error: listErr.message || "rpc failed",
          details: listErr.details,
          hint: listErr.hint,
          code: listErr.code,
        },
        { status: 500 }
      );
    }

    const paths = ((orphans || []) as Array<{ name: string }>)
      .map((o) => o.name)
      .filter(Boolean);

    if (paths.length === 0) {
      return NextResponse.json({ ok: true, orphans_found: 0, deleted: 0 });
    }

    // 2. Delete via the Storage API. Batches of 100 to stay under
    //    request payload limits.
    let deleted = 0;
    const errors: string[] = [];
    for (let i = 0; i < paths.length; i += 100) {
      const batch = paths.slice(i, i + 100);
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
      orphans_found: paths.length,
      deleted,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (e) {
    // Catch-all: stringify in a way that exposes more than
    // `[object Object]`. Supabase often throws plain objects with
    // useful fields, so JSON.stringify those.
    let msg = "unknown error";
    if (e instanceof Error) {
      msg = e.message;
    } else if (e && typeof e === "object") {
      try {
        msg = JSON.stringify(e);
      } catch {
        msg = "(unserialisable error)";
      }
    } else {
      msg = String(e);
    }
    console.error("[cron/cleanup-orphan-chat-media]", msg, e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
