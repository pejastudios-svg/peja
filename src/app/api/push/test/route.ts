import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../_supabaseAdmin";
import { getFirebaseAdmin } from "../../_firebaseAdmin";

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

  // Verify Firebase admin init
  let firebaseProjectId: string | null = null;
  let firebaseInitError: string | null = null;
  try {
    const app = getFirebaseAdmin();
    firebaseProjectId = app.options.projectId || null;
  } catch (e: any) {
    firebaseInitError = e?.message || String(e);
  }

  // 2. Try sending to each token, surfacing full error detail
  const results = await Promise.all(
    tokens.map(async (t) => {
      try {
        const app = getFirebaseAdmin();
        await app.messaging().send({
          token: t.token,
          data: { type: "test", title: "Peja Test", body: "Push test", channelId: "peja_alerts" },
          android: {
            priority: "high",
            ttl: 300000,
            notification: {
              channelId: "peja_alerts",
              title: "Peja Test",
              body: "Push notification test — if you see this, it works!",
              sound: "peja_alert",
              visibility: "public",
              icon: "ic_notification",
              defaultVibrateTimings: true,
              notificationCount: 1,
            },
          },
        });
        return {
          tokenId: t.id,
          token: t.token.slice(0, 20) + "...",
          result: "sent" as const,
          updatedAt: t.updated_at,
        };
      } catch (err: any) {
        return {
          tokenId: t.id,
          token: t.token.slice(0, 20) + "...",
          result: "error" as const,
          errorCode: err?.code || null,
          errorMessage: err?.message || String(err),
          errorInfo: err?.errorInfo || null,
          updatedAt: t.updated_at,
        };
      }
    })
  );

  const anySuccess = results.some((r) => r.result === "sent");

  return NextResponse.json({
    firebaseProjectId,
    firebaseInitError,
    firebaseServiceAccountSet: !!process.env.FIREBASE_SERVICE_ACCOUNT,
    tokenCount: tokens.length,
    results,
    diagnosis: anySuccess
      ? "Push sent successfully — check your device."
      : "Send failed. See results[].errorCode / errorMessage.",
  });
}
