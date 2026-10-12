import { NextRequest, NextResponse } from "next/server";
import { requireUser, authErrorResponse } from "../../_auth";
import { getSupabaseAdmin } from "../../_supabaseAdmin";

export const runtime = "nodejs";

/**
 * Move a finished pre-upload out of temp/ and into posts/.
 *
 * SERVER side, with the service role, and that is the whole point of this
 * route existing. The browser client runs as the signed-in user, and a
 * storage move needs delete on the source object as well as insert on the
 * destination. Doing it from the client failed silently against storage
 * RLS, the post kept its temp/ URL, and the 24h temp sweep then deleted
 * the image out from under a live post.
 *
 * Why it matters: anything still sitting in temp/ is removed by the
 * checkin-monitor cron after a day, with no check for whether a post
 * points at it. A published post holding a temp/ URL loses its picture
 * overnight.
 *
 * The elections upload route has always done the same thing for the same
 * reason; the post flow is catching up.
 */
export async function POST(req: NextRequest) {
  try {
    const { user } = await requireUser(req);
    const { tempPath } = await req.json();

    if (!tempPath || typeof tempPath !== "string") {
      return NextResponse.json({ ok: false, error: "tempPath required" }, { status: 400 });
    }

    // Shape AND ownership. preUploadFile names every file
    // `temp/<uid>-<ms>-<rand>.<ext>`, so the prefix check is what stops
    // one account moving (and so taking) another account's upload.
    if (
      !/^temp\/[A-Za-z0-9-]+-\d+-[a-z0-9]+\.[a-z0-9]{2,5}$/i.test(tempPath) ||
      !tempPath.startsWith(`temp/${user.id}-`)
    ) {
      return NextResponse.json({ ok: false, error: "Invalid path" }, { status: 400 });
    }

    const ext = tempPath.split(".").pop()!.toLowerCase();
    const finalPath = `posts/${user.id}/${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 9)}.${ext}`;

    const supabaseAdmin = getSupabaseAdmin();
    const { error } = await supabaseAdmin.storage.from("media").move(tempPath, finalPath);

    if (error) {
      console.error("[promote-media] move failed:", error.message, tempPath);
      return NextResponse.json({ ok: false, error: "Could not move the file" }, { status: 500 });
    }

    const { data } = supabaseAdmin.storage.from("media").getPublicUrl(finalPath);
    return NextResponse.json({ ok: true, url: data.publicUrl, path: finalPath });
  } catch (error) {
    return (
      authErrorResponse(error) ??
      NextResponse.json({ ok: false, error: "Failed" }, { status: 500 })
    );
  }
}
