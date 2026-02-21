import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "../../_auth";
import { getSupabaseAdmin } from "../../_supabaseAdmin";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    await requireAdmin(req);

    const { userId, status, reason } = await req.json();
    if (!userId || !["active", "suspended", "banned"].includes(status)) {
      return NextResponse.json({ ok: false, error: "Invalid payload" }, { status: 400 });
    }

    const supabaseAdmin = getSupabaseAdmin();

    const { data: before, error: beforeErr } = await supabaseAdmin
      .from("users")
      .select("id,status,email,full_name")
      .eq("id", userId)
      .single();

    if (beforeErr || !before) {
      return NextResponse.json({ ok: false, error: "User not found" }, { status: 404 });
    }

    const { data, error } = await supabaseAdmin
      .from("users")
      .update({ status })
      .eq("id", userId)
      .select("id,status,email,full_name")
      .single();

    if (error) {
      return NextResponse.json(
        { ok: false, error: `${error.code || ""} ${error.message}`.trim() },
        { status: 400 }
      );
    }

    const oldStatus = before.status;
    const newStatus = data.status;
    const webhookUrl = process.env.APPS_SCRIPT_EMAIL_WEBHOOK_URL;
    const webhookSecret = process.env.APPS_SCRIPT_WEBHOOK_SECRET || "";

    // Only notify if status actually changed
    if (oldStatus !== newStatus) {
      // ============================================
      // SUSPENDED
      // ============================================
      if (newStatus === "suspended") {
        // In-app notification
        await supabaseAdmin.from("notifications").insert({
          user_id: userId,
          type: "system",
          title: "Account suspended",
          body: "Your account has been suspended. You can still receive alerts, but you cannot post or interact until your suspension is lifted.",
          data: { status: "suspended", reason: reason || "Policy violation" },
          is_read: false,
        });

        // Send suspend email
        if (webhookUrl && data.email) {
          try {
            await fetch(webhookUrl, {
              method: "POST",
              headers: { 
                "Content-Type": "application/json", 
                "X-Peja-Secret": webhookSecret,
              },
              body: JSON.stringify({
                secret: webhookSecret,
                template: "suspend",
                to: data.email,
                full_name: data.full_name || "",
                reason: reason || "Policy violation",
              }),
            });
          } catch (e) {
            console.error("Failed to send suspend email:", e);
          }
        }
      }

      // ============================================
      // BANNED
      // ============================================
      if (newStatus === "banned") {
        // In-app notification
        await supabaseAdmin.from("notifications").insert({
          user_id: userId,
          type: "system",
          title: "Account banned",
          body: "Your account has been banned. If you believe this is a mistake, contact support.",
          data: { status: "banned", reason: reason || "Policy violation" },
          is_read: false,
        });

        // Send ban email
        if (webhookUrl && data.email) {
          try {
            await fetch(webhookUrl, {
              method: "POST",
              headers: { 
                "Content-Type": "application/json", 
                "X-Peja-Secret": webhookSecret,
              },
              body: JSON.stringify({
                secret: webhookSecret,
                template: "ban",
                to: data.email,
                full_name: data.full_name || "",
                reason: reason || "Policy violation",
              }),
            });
          } catch (e) {
            console.error("Failed to send ban email:", e);
          }
        }
      }

      // ============================================
      // UN-SUSPENDED (suspended → active)
      // ============================================
      if (oldStatus === "suspended" && newStatus === "active") {
        // In-app notification
        await supabaseAdmin.from("notifications").insert({
          user_id: userId,
          type: "system",
          title: "Account restored",
          body: "Your account suspension has been lifted. You can now post, comment, and interact normally.",
          data: { status: "active", restored_from: "suspended" },
          is_read: false,
        });

        // Send un-suspend email
        if (webhookUrl && data.email) {
          try {
            await fetch(webhookUrl, {
              method: "POST",
              headers: { 
                "Content-Type": "application/json", 
                "X-Peja-Secret": webhookSecret,
              },
              body: JSON.stringify({
                secret: webhookSecret,
                template: "unsuspend",
                to: data.email,
                full_name: data.full_name || "",
              }),
            });
          } catch (e) {
            console.error("Failed to send unsuspend email:", e);
          }
        }
      }

      // ============================================
      // UN-BANNED (banned → active)
      // ============================================
      if (oldStatus === "banned" && newStatus === "active") {
        // In-app notification
        await supabaseAdmin.from("notifications").insert({
          user_id: userId,
          type: "system",
          title: "Account restored",
          body: "Your account ban has been lifted. Welcome back! You can now use Peja normally.",
          data: { status: "active", restored_from: "banned" },
          is_read: false,
        });

        // Send un-ban email
        if (webhookUrl && data.email) {
          try {
            await fetch(webhookUrl, {
              method: "POST",
              headers: { 
                "Content-Type": "application/json", 
                "X-Peja-Secret": webhookSecret,
              },
              body: JSON.stringify({
                secret: webhookSecret,
                template: "unban",
                to: data.email,
                full_name: data.full_name || "",
              }),
            });
          } catch (e) {
            console.error("Failed to send unban email:", e);
          }
        }
      }
    }

    return NextResponse.json({ ok: true, user: data });
  } catch (e: any) {
    console.error("set-user-status error:", e);
    return NextResponse.json({ ok: false, error: e?.message || "Server error" }, { status: 500 });
  }
}