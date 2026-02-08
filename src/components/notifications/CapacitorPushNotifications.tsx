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

        // Request permission
        const permResult = await PushNotifications.requestPermissions();

        if (permResult.receive === "granted") {
          // Register with FCM
          await PushNotifications.register();
        } else {
          console.log("[Push] Permission denied");
          return;
        }

        // Listen for registration success
        PushNotifications.addListener("registration", async (token) => {
          console.log("[Push] FCM Token:", token.value);

          // Save the token to your database
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

            // You can show an in-app toast or banner here
            // The notification is already handled by your existing
            // InAppNotificationToasts component via Supabase realtime
          }
        );

        // Listen for notification taps (user clicked the notification)
        PushNotifications.addListener(
          "pushNotificationActionPerformed",
          (action) => {
            console.log("[Push] Notification tapped:", action);

            const data = action.notification.data;

            // Navigate based on notification data
            if (data?.post_id) {
              router.push(`/post/${data.post_id}`);
            } else if (data?.sos_id) {
              router.push("/sos");
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