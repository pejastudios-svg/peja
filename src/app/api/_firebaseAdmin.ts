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

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

// Derive FCM delivery policy from notification type. Drives how long FCM
// will queue the message for an offline device and whether reconnecting
// phones get one latest message per topic vs. a flood of duplicates.
function derivePushPolicy(data?: Record<string, string>): {
  ttlMs: number;
  collapseKey?: string;
} {
  const type = data?.type;

  switch (type) {
    // Urgent safety — stale pushes would mislead. Short TTL, collapse per-event.
    case "sos_alert":
      return {
        ttlMs: 5 * MINUTE,
        collapseKey: data?.sos_id ? `sos-${data.sos_id}` : undefined,
      };
    case "safety_checkin_warning":
      return {
        ttlMs: 5 * MINUTE,
        collapseKey: data?.checkin_id ? `checkin-warn-${data.checkin_id}` : undefined,
      };

    // Time-sensitive but still actionable for a while.
    case "nearby_incident":
      return {
        ttlMs: 30 * MINUTE,
        collapseKey: data?.post_id ? `incident-${data.post_id}` : undefined,
      };
    case "safety_checkin_missed":
    case "safety_checkin_self_expired":
      return {
        ttlMs: 30 * MINUTE,
        collapseKey: data?.checkin_id ? `checkin-exp-${data.checkin_id}` : undefined,
      };

    // DMs: useful for hours; only want the latest per conversation on reconnect.
    case "dm_message":
    case "dm_reaction":
      return {
        ttlMs: 24 * HOUR,
        collapseKey: data?.conversation_id ? `dm-${data.conversation_id}` : undefined,
      };

    // Standard conversational / status updates — worth delivering up to a day later.
    default:
      return { ttlMs: 24 * HOUR };
  }
}

export async function sendPushNotification(params: {
  token: string;
  title: string;
  body: string;
  data?: Record<string, string>;
  ttlMs?: number;
  collapseKey?: string;
}): Promise<SendResult> {
  try {
    const firebaseApp = getFirebaseAdmin();
    const messaging = firebaseApp.messaging();

    const channelId = params.data?.sos_id ? "peja_sos" : "peja_alerts";
    const policy = derivePushPolicy(params.data);
    const ttl = params.ttlMs ?? policy.ttlMs;
    const collapseKey = params.collapseKey ?? policy.collapseKey;

    await messaging.send({
      token: params.token,
      data: {
        ...(params.data || {}),
        title: params.title,
        body: params.body || "",
        channelId: channelId,
      },
      // Web/iOS-PWA tokens: DATA-ONLY on purpose. Safari never
      // auto-displays pushes (the SW must call showNotification), and
      // Chrome auto-displays only when webpush.notification is present -
      // which would DOUBLE with the SW's display. Data-only + SW display
      // = exactly one notification on every browser.
      webpush: {
        headers: {
          TTL: String(Math.max(60, Math.floor(ttl / 1000))),
          ...(collapseKey ? { Topic: collapseKey } : {}),
        },
      },
      android: {
        priority: "high",
        ttl,
        ...(collapseKey ? { collapseKey } : {}),
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

/**
 * Sends a DATA-ONLY high-priority message — no `notification` block, so the
 * system shows nothing. High-priority data messages reach the native
 * FirebaseMessagingService even when the app has been killed (and FCM grants a
 * short window to start a foreground service), which is how we revive
 * background location tracking on OEMs (Transsion/Xiaomi/etc.) that kill the
 * app and block its own service from restarting.
 */
export async function sendSilentData(params: {
  token: string;
  data: Record<string, string>;
  ttlMs?: number;
  collapseKey?: string;
}): Promise<SendResult> {
  try {
    const firebaseApp = getFirebaseAdmin();
    const messaging = firebaseApp.messaging();

    await messaging.send({
      token: params.token,
      data: params.data,
      android: {
        priority: "high",
        ttl: params.ttlMs ?? 2 * MINUTE,
        ...(params.collapseKey ? { collapseKey: params.collapseKey } : {}),
        // Deliberately no `notification` block — silent wake only.
      },
    });

    return "sent";
  } catch (error: any) {
    const INVALID_CODES = [
      "messaging/registration-token-not-registered",
      "messaging/invalid-registration-token",
      "messaging/invalid-argument",
    ];
    if (INVALID_CODES.includes(error?.code)) {
      return "invalid";
    }
    return "error";
  }
}

export async function sendSilentDataToUser(params: {
  userId: string;
  data: Record<string, string>;
  ttlMs?: number;
  collapseKey?: string;
}): Promise<number> {
  const { getSupabaseAdmin } = await import("./_supabaseAdmin");
  const supabaseAdmin = getSupabaseAdmin();

  const { data: tokens, error } = await supabaseAdmin
    .from("user_push_tokens")
    .select("id, token")
    .eq("user_id", params.userId);

  if (error || !tokens || tokens.length === 0) return 0;

  let sentCount = 0;
  const invalidTokenIds: string[] = [];

  for (const tokenRow of tokens) {
    const result = await sendSilentData({
      token: tokenRow.token,
      data: params.data,
      ttlMs: params.ttlMs,
      collapseKey: params.collapseKey,
    });
    if (result === "sent") sentCount++;
    else if (result === "invalid") invalidTokenIds.push(tokenRow.id);
  }

  if (invalidTokenIds.length > 0) {
    await supabaseAdmin
      .from("user_push_tokens")
      .delete()
      .in("id", invalidTokenIds);
  }

  return sentCount;
}

export async function sendPushToUser(params: {
  userId: string;
  title: string;
  body: string;
  data?: Record<string, string>;
  ttlMs?: number;
  collapseKey?: string;
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
      ttlMs: params.ttlMs,
      collapseKey: params.collapseKey,
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