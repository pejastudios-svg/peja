import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

export async function GET(req: Request) {
  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const token = authHeader.slice(7);
    const {
      data: { user },
      error: authErr,
    } = await supabaseAdmin.auth.getUser(token);
    if (authErr || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: profile } = await supabaseAdmin
      .from("users")
      .select("is_admin")
      .eq("id", user.id)
      .single();
    if (!profile?.is_admin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    /* active SOS alerts */
    const { data: activeAlerts } = await supabaseAdmin
      .from("sos_alerts")
      .select("id, user_id, latitude, longitude, address, tag, created_at")
      .eq("status", "active");

    if (!activeAlerts || activeAlerts.length === 0) {
      return NextResponse.json({ helpers: [], sosAlerts: [] });
    }

    /* SOS owner info */
    const ownerIds = [...new Set(activeAlerts.map((s) => s.user_id))];
    const { data: ownerUsers } = await supabaseAdmin
      .from("users")
      .select("id, full_name, avatar_url")
      .in("id", ownerIds);
    const ownerMap = new Map(
      (ownerUsers || []).map((u) => [u.id, { name: u.full_name, avatar: u.avatar_url }])
    );

    const sosOut = activeAlerts.map((s) => ({
      id: s.id,
      user_id: s.user_id,
      latitude: s.latitude,
      longitude: s.longitude,
      address: s.address,
      tag: s.tag,
      created_at: s.created_at,
      userName: ownerMap.get(s.user_id)?.name || "Unknown",
      userAvatar: ownerMap.get(s.user_id)?.avatar || null,
    }));

    /* helper notifications */
    const fiveH = new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString();
    const sosIds = activeAlerts.map((s) => s.id);

    const { data: notifs } = await supabaseAdmin
      .from("notifications")
      .select("data, created_at")
      .eq("type", "sos_alert")
      .gte("created_at", fiveH)
      .order("created_at", { ascending: false })
      .limit(500);

    const helperMap = new Map<
      string,
      {
        id: string;
        name: string;
        avatar_url: string | null;
        lat: number;
        lng: number;
        eta: number;
        sosId: string;
        milestone: string | null;
        lastUpdate: string;
      }
    >();

    for (const n of notifs || []) {
      const d = n.data as any;
      if (!d?.helper_id || !d?.sos_id || !d?.helper_lat || !d?.helper_lng) continue;
      if (!sosIds.includes(d.sos_id)) continue;

      const key = `${d.helper_id}:${d.sos_id}`;
      if (!helperMap.has(key)) {
        helperMap.set(key, {
          id: d.helper_id,
          name: d.helper_name || "Helper",
          avatar_url: d.helper_avatar || null,
          lat: d.helper_lat,
          lng: d.helper_lng,
          eta: d.eta_minutes || 0,
          sosId: d.sos_id,
          milestone: d.milestone || null,
          lastUpdate: n.created_at,
        });
      }
    }

    return NextResponse.json({
      helpers: Array.from(helperMap.values()),
      sosAlerts: sosOut,
    });
  } catch (e) {
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}