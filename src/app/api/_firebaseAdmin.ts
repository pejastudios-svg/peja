import admin from "firebase-admin";

let app: admin.app.App | null = null;

export function getFirebaseAdmin(): admin.app.App {
  if (app) return app;

  const serviceAccountJSON = process.env.FIREBASE_SERVICE_ACCOUNT;

  if (!serviceAccountJSON) {
    throw new Error("Missing env: FIREBASE_SERVICE_ACCOUNT");
  }

  let serviceAccount: admin.ServiceAccount;

  try {
    serviceAccount = JSON.parse(serviceAccountJSON);
  } catch (e) {
    throw new Error("Invalid FIREBASE_SERVICE_ACCOUNT JSON");
  }

  app = admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    projectId: process.env.FIREBASE_PROJECT_ID || "peja-f1be0",
  });

  return app;
}

// "sent" = delivered, "invalid" = token is dead and should be deleted, "error" = transient failure keep the token
type SendResult = "sent" | "invalid" | "error";

export async function sendPushNotification(params: {
  token: string;
  title: string;
  body: string;
  data?: Record<string, string>;
}): Promise<SendResult> {
  try {
    const firebaseApp = getFirebaseAdmin();
    const messaging = firebaseApp.messaging();

    const channelId = params.data?.sos_id ? "peja_sos" : "peja_alerts";

    await messaging.send({
      token: params.token,
      data: {
        ...(params.data || {}),
        title: params.title,
        body: params.body || "",
        channelId: channelId,
      },
      android: {
        priority: "high",
        ttl: 300000,
        notification: {
          channelId: channelId,
          title: params.title,
          body: params.body,
          sound: "peja_alert",
          visibility: "public",
          icon: "ic_notification",
          defaultVibrateTimings: true,
          notificationCount: 1,
        },
      },
    });

    return "sent";
  } catch (error: any) {
    // Only delete the token when Firebase explicitly says it's invalid/unregistered
    const INVALID_CODES = [
      "messaging/registration-token-not-registered",
      "messaging/invalid-registration-token",
      "messaging/invalid-argument",
    ];
    if (INVALID_CODES.includes(error?.code)) {
      return "invalid";
    }
    // Transient error (network, quota, server) — keep the token
    return "error";
  }
}

export async function sendPushToUser(params: {
  userId: string;
  title: string;
  body: string;
  data?: Record<string, string>;
}): Promise<number> {
  const { getSupabaseAdmin } = await import("./_supabaseAdmin");
  const supabaseAdmin = getSupabaseAdmin();

  // Get all tokens for this user
  const { data: tokens, error } = await supabaseAdmin
    .from("user_push_tokens")
    .select("id, token")
    .eq("user_id", params.userId);

  if (error || !tokens || tokens.length === 0) {
    return 0;
  }

  let sentCount = 0;
  const invalidTokenIds: string[] = [];

  for (const tokenRow of tokens) {
    const result = await sendPushNotification({
      token: tokenRow.token,
      title: params.title,
      body: params.body,
      data: params.data,
    });

    if (result === "sent") {
      sentCount++;
    } else if (result === "invalid") {
      // Only delete tokens Firebase explicitly rejected — never on transient errors
      invalidTokenIds.push(tokenRow.id);
    }
  }

  if (invalidTokenIds.length > 0) {
    await supabaseAdmin
      .from("user_push_tokens")
      .delete()
      .in("id", invalidTokenIds);
  }

  return sentCount;
}