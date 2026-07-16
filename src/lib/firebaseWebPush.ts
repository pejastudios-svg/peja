// Web push registration (iOS Home Screen PWA + desktop/Android browsers).
// Native apps register through the Capacitor plugin; this is the WEB
// counterpart: same user_push_tokens table, platform "web", so
// sendPushToUser reaches both without changes.
//
// Env (Firebase console -> Project settings):
//   NEXT_PUBLIC_FIREBASE_API_KEY / AUTH_DOMAIN / PROJECT_ID /
//   MESSAGING_SENDER_ID / APP_ID       (General -> Your apps -> Web app)
//   NEXT_PUBLIC_FIREBASE_VAPID_KEY     (Cloud Messaging -> Web Push certificates)

import { getApps, initializeApp } from "firebase/app";
import { getMessaging, getToken, isSupported } from "firebase/messaging";
import { supabase } from "./supabase";

function webConfig() {
  const cfg = {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  };
  return cfg.apiKey && cfg.projectId && cfg.messagingSenderId && cfg.appId ? cfg : null;
}

export function webPushConfigured(): boolean {
  return Boolean(webConfig() && process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY);
}

/** True when this browser can do web push at all (iOS Safari says no
 * outside a Home Screen app; standalone 16.4+ says yes). */
export async function webPushSupported(): Promise<boolean> {
  if (!webPushConfigured()) return false;
  if (!("Notification" in window) || !("serviceWorker" in navigator)) return false;
  try {
    return await isSupported();
  } catch {
    return false;
  }
}

/**
 * Request permission (must be called from a user gesture when permission
 * is not yet granted), mint the FCM web token against our existing
 * service worker, and store it. Returns true when push is live.
 */
export async function registerWebPush(userId: string): Promise<boolean> {
  try {
    if (!(await webPushSupported())) return false;

    if (Notification.permission === "default") {
      const res = await Notification.requestPermission();
      if (res !== "granted") return false;
    }
    if (Notification.permission !== "granted") return false;

    const cfg = webConfig()!;
    const app = getApps()[0] ?? initializeApp(cfg);
    const messaging = getMessaging(app);
    const reg = await navigator.serviceWorker.ready;
    const token = await getToken(messaging, {
      vapidKey: process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY,
      serviceWorkerRegistration: reg,
    });
    if (!token) return false;

    await supabase.from("user_push_tokens").upsert(
      {
        user_id: userId,
        token,
        platform: "web",
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,token" }
    );
    return true;
  } catch (e) {
    console.warn("[webpush] registration failed:", e);
    return false;
  }
}
