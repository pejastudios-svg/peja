"use client";

import { useEffect, useRef } from "react";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/lib/supabase";

export function CapacitorPushNotifications() {
  const { user } = useAuth();
  const listenersSetRef = useRef(false);

  useEffect(() => {
    if (!user) return;
    if (typeof window === "undefined") return;

    const isCapacitor =
      (window as any).Capacitor !== undefined ||
      navigator.userAgent.includes("CapacitorApp");

    if (!isCapacitor) return;

    const setupPush = async () => {
      try {
        const { PushNotifications } = await import("@capacitor/push-notifications");
        const { App } = await import("@capacitor/app");

        // Create channels once — never delete them. Deleting a channel
        // dismisses all its notifications and triggers Android 12 rate limits.
        // createChannel is a no-op if the channel already exists.
        try {
          await PushNotifications.createChannel({
            id: "peja_alerts",
            name: "Peja Alerts",
            description: "Incident alerts and notifications",
            importance: 5,
            visibility: 1,
            sound: "peja_alert",
            vibration: true,
            lights: true,
          });
          await PushNotifications.createChannel({
            id: "peja_sos",
            name: "SOS Alerts",
            description: "Emergency SOS notifications",
            importance: 5,
            visibility: 1,
            sound: "peja_alert",
            vibration: true,
            lights: true,
          });
        } catch {}

        // Add listeners once — before register() to avoid any race condition
        if (!listenersSetRef.current) {
          listenersSetRef.current = true;

          PushNotifications.addListener("registration", async (token) => {
            try {
              await supabase
                .from("user_push_tokens")
                .upsert(
                  {
                    user_id: user.id,
                    token: token.value,
                    platform: "android",
                    updated_at: new Date().toISOString(),
                  },
                  { onConflict: "user_id,token" }
                );
            } catch {}
          });

          PushNotifications.addListener("registrationError", () => {});

          PushNotifications.addListener("pushNotificationReceived", () => {});

          PushNotifications.addListener(
            "pushNotificationActionPerformed",
            (action) => {
              const data = action.notification.data;
              if (data?.sos_id) {
                if (data?.latitude && data?.longitude) {
                  window.location.href = `/map?lat=${data.latitude}&lng=${data.longitude}&sos=${data.sos_id}`;
                } else {
                  window.location.href = "/map";
                }
              } else if (data?.post_id) {
                window.location.href = `/post/${data.post_id}`;
              } else if (data?.type === "guardian_approved") {
                window.location.href = "/guardian";
              } else {
                window.location.href = "/notifications";
              }
            }
          );
        }

        const registerToken = async () => {
          const permResult = await PushNotifications.requestPermissions();
          if (permResult.receive === "granted") {
            await PushNotifications.register();
          }
        };

        await registerToken();

        // Re-register every time the app comes to foreground to catch
        // FCM token rotations — this is what causes "stops working after
        // a while" on Android 12 devices.
        App.addListener("appStateChange", ({ isActive }) => {
          if (isActive) registerToken();
        });
      } catch {}
    };

    setupPush();
  }, [user]);

  return null;
}