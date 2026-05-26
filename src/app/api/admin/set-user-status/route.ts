import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "../../_auth";
import { getSupabaseAdmin } from "../../_supabaseAdmin";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const { user: adminUser } = await requireAdminSession(req);

    const { userId, status, reason, suspendedUntil } = await req.json();
    if (!userId || !["active", "suspended", "banned"].includes(status)) {
      return NextResponse.json({ ok: false, error: "Invalid payload" }, { status: 400 });
    }

    // Validate suspendedUntil (optional ISO timestamp, only meaningful for
    // "suspended"). NULL or omitted = indefinite — admin lifts manually.
    let suspendedUntilTs: string | null = null;
    if (status === "suspended" && suspendedUntil) {
      const d = new Date(suspendedUntil);
      if (isNaN(d.getTime())) {
        return NextResponse.json({ ok: false, error: "Invalid suspendedUntil" }, { status: 400 });
      }
      if (d.getTime() <= Date.now()) {
        return NextResponse.json({ ok: false, error: "suspendedUntil must be in the future" }, { status: 400 });
      }
      suspendedUntilTs = d.toISOString();
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

    // Build the patch. Always persist the reason + audit columns alongside
    // the status flip so the admin UI / user-detail page can show context.
    // On restoration (→ active) clear the columns for whichever state we're
    // leaving — keeps the row tidy and makes "active" actually mean active.
    const now = new Date().toISOString();
    const patch: Record<string, any> = { status };
    if (status === "suspended") {
      patch.suspension_reason = reason || null;
      patch.suspended_at = now;
      patch.suspended_until = suspendedUntilTs;
      patch.suspended_by = adminUser.id;
    } else if (status === "banned") {
      patch.ban_reason = reason || null;
      patch.banned_at = now;
      patch.banned_by = adminUser.id;
    } else if (status === "active") {
      if (before.status === "suspended") {
        patch.suspension_reason = null;
        patch.suspended_at = null;
        patch.suspended_until = null;
        patch.suspended_by = null;
      } else if (before.status === "banned") {
        patch.ban_reason = null;
        patch.banned_at = null;
        patch.banned_by = null;
      }
    }

    const { data, error } = await supabaseAdmin
      .from("users")
      .update(patch)
      .eq("id", userId)
      .select("id,status,email,full_name,suspension_reason,suspended_until,ban_reason")
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
          body: "Your account has been banned. If you believe this is a mistake, contact support at pejastudios@gmail.com.",
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
          }
        }
      }
    }

    return NextResponse.json({ ok: true, user: data });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Server error" }, { status: 500 });
  }
}