"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/lib/supabase";

export function CapacitorPushNotifications() {
  const router = useRouter();
  const { user } = useAuth();
  const registeredRef = useRef(false);

  useEffect(() => {
    if (!user) return;
    if (registeredRef.current) return;
    if (typeof window === "undefined") return;

    const isCapacitor =
      (window as any).Capacitor !== undefined ||
      navigator.userAgent.includes("CapacitorApp");

    if (!isCapacitor) return;

    registeredRef.current = true;

    const setupPush = async () => {
      try {
        const { PushNotifications } = await import(
          "@capacitor/push-notifications"
        );

        // Delete old channels and recreate with correct settings
        // Android caches channel settings — deleting forces a fresh start
        try {
          // Delete old channels (silently fails if they don't exist)
          try { await PushNotifications.deleteChannel({ id: "peja_alerts" }); } catch {}
          try { await PushNotifications.deleteChannel({ id: "peja_sos" }); } catch {}
          try { await PushNotifications.deleteChannel({ id: "default" }); } catch {}

          // Create channels fresh with maximum importance
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

          console.log("[Push] Notification channels created successfully");
        } catch (channelErr) {
          console.warn("[Push] Channel creation error:", channelErr);
        }

        // Request permission
        const permResult = await PushNotifications.requestPermissions();

        if (permResult.receive === "granted") {
          await PushNotifications.register();
        } else {
          console.log("[Push] Permission denied");
          return;
        }

        // Listen for registration success
        PushNotifications.addListener("registration", async (token) => {
          console.log("[Push] FCM Token:", token.value);

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

            console.log("[Push] Token saved to database");
          } catch (err) {
            console.error("[Push] Failed to save token:", err);
          }
        });

        // Listen for registration errors
        PushNotifications.addListener("registrationError", (error) => {
          console.error("[Push] Registration error:", error);
        });

        // Listen for notifications received while app is in foreground
        PushNotifications.addListener(
          "pushNotificationReceived",
          (notification) => {
            console.log("[Push] Foreground notification:", notification);
          }
        );

        // Listen for notification taps
        PushNotifications.addListener(
          "pushNotificationActionPerformed",
          (action) => {
            console.log("[Push] Notification tapped:", action);

            const data = action.notification.data;

            if (data?.sos_id) {
              if (data?.latitude && data?.longitude) {
                router.push(`/map?lat=${data.latitude}&lng=${data.longitude}&sos=${data.sos_id}`);
              } else {
                router.push("/map");
              }
            } else if (data?.post_id) {
              router.push(`/post/${data.post_id}`);
            } else if (data?.type === "guardian_approved") {
              router.push("/guardian");
            } else {
              router.push("/notifications");
            }
          }
        );
      } catch (err) {
        console.error("[Push] Setup error:", err);
      }
    };

    setupPush();
  }, [user, router]);

  return null;
}