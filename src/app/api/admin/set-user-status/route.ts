import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "../../_auth";
import { getSupabaseAdmin } from "../../_supabaseAdmin";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    await requireAdmin(req);

    const { userId, status } = await req.json();
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

    // Only notify if status actually changed
    if (oldStatus !== newStatus) {
      if (newStatus === "suspended") {
        await supabaseAdmin.from("notifications").insert({
          user_id: userId,
          type: "system",
          title: "Account suspended",
          body: "Your account has been suspended. You can still receive alerts, but you cannot post or interact until your suspension is lifted.",
          data: { status: "suspended" },
          is_read: false,
        });
      }

      if (newStatus === "banned") {
              if (newStatus === "suspended") {
        const url = process.env.APPS_SCRIPT_EMAIL_WEBHOOK_URL;
        if (url && data.email) {
          try {
            await fetch(url, {
              method: "POST",
              headers: { "Content-Type": "application/json", "X-Peja-Secret": process.env.APPS_SCRIPT_WEBHOOK_SECRET || "",},
              body: JSON.stringify({
             secret: process.env.APPS_SCRIPT_WEBHOOK_SECRET || "",
             to: data.email,
             template: "ban",
             full_name: data.full_name || "",
             reason: "Policy violation",
            }),
            });
          } catch {
            // best-effort
          }
        }
      }
        await supabaseAdmin.from("notifications").insert({
          user_id: userId,
          type: "system",
          title: "Account banned",
          body: "Your account has been banned. If you believe this is a mistake, contact support.",
          data: { status: "banned" },
          is_read: false,
        });

        // Send ban email via Apps Script (best-effort)
        const url = process.env.APPS_SCRIPT_EMAIL_WEBHOOK_URL;
        if (url && data.email) {
          try {
            await fetch(url, {
              method: "POST",
              headers: { "Content-Type": "application/json", "X-Peja-Secret": process.env.APPS_SCRIPT_WEBHOOK_SECRET || "",},
              body: JSON.stringify({
             secret: process.env.APPS_SCRIPT_WEBHOOK_SECRET || "",
             to: data.email,
             template: "ban",
             full_name: data.full_name || "",
             reason: "Policy violation",
            }),
            });
          } catch {
            // do not block the API if email fails
          }
        }
      }
    }
    return NextResponse.json({ ok: true, user: data });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Server error" }, { status: 500 });
  }
}