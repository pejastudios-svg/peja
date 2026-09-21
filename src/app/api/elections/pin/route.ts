import { NextRequest, NextResponse } from "next/server";
import { requireUser, authErrorResponse } from "../../_auth";
import { getSupabaseAdmin } from "../../_supabaseAdmin";
import { getElectionActor, setElectionPin } from "../../_electionAuth";
import { isRateLimitedDurable } from "../../_rateLimit";

// Election PIN: status + set/change. Verification never happens here on
// its own; the PIN rides along with each actual action so there is no
// oracle to grind against. Only VIP/MVP/admin accounts have any business
// on this route.

export async function GET(req: NextRequest) {
  try {
    const { user } = await requireUser(req);
    const supabaseAdmin = getSupabaseAdmin();
    const actor = await getElectionActor(supabaseAdmin, user.id);
    if (!actor.canWrite) return NextResponse.json({ error: "Not available" }, { status: 403 });
    return NextResponse.json({
      ok: true,
      pinSet: actor.pinSet,
      locked: actor.locked,
      frozen: actor.frozen,
      canTally: actor.canTally,
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
    if (!actor.canWrite) return NextResponse.json({ error: "Not available" }, { status: 403 });

    if (await isRateLimitedDurable(`election-pin-set:${user.id}`, 5, 3600)) {
      return NextResponse.json({ error: "Too many attempts. Try later." }, { status: 429 });
    }

    const { pin, oldPin } = await req.json();
    const result = await setElectionPin(supabaseAdmin, user.id, String(pin ?? ""), oldPin ? String(oldPin) : undefined);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return (
      authErrorResponse(error) ?? NextResponse.json({ error: "Failed" }, { status: 500 })
    );
  }
}
