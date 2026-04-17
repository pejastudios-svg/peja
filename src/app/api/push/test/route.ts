import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../_supabaseAdmin";
import { sendPushNotification } from "../../_firebaseAdmin";

// Test endpoint: GET /api/push/test?userId=xxx
// Returns exactly where the push chain is breaking
export async function GET(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get("userId");
  if (!userId) return NextResponse.json({ error: "userId required" }, { status: 400 });

  const supabaseAdmin = getSupabaseAdmin();

  // 1. Check tokens in DB
  const { data: tokens, error: tokenError } = await supabaseAdmin
    .from("user_push_tokens")
    .select("id, token, platform, updated_at")
    .eq("user_id", userId);

  if (tokenError) {
    return NextResponse.json({ step: "db_query", error: tokenError.message });
  }

  if (!tokens || tokens.length === 0) {
    return NextResponse.json({
      step: "no_tokens",
      diagnosis: "No FCM tokens found for this user. Open the Android app to re-register.",
    });
  }

  // 2. Try sending to each token
  const results = await Promise.all(
    tokens.map(async (t) => {
      const result = await sendPushNotification({
        token: t.token,
        title: "Peja Test",
        body: "Push notification test — if you see this, it works!",
        data: { type: "test" },
      });
      return { tokenId: t.id, token: t.token.slice(0, 20) + "...", result, updatedAt: t.updated_at };
    })
  );

  const anySuccess = results.some((r) => r.result === "sent");
  const allInvalid = results.every((r) => r.result === "invalid");

  return NextResponse.json({
    tokenCount: tokens.length,
    results,
    diagnosis: anySuccess
      ? "Push sent successfully — check your device."
      : allInvalid
      ? "All tokens are invalid/expired. Open the Android app to re-register."
      : "Firebase returned transient errors. Check FIREBASE_SERVICE_ACCOUNT env var.",
  });
}
