import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession, authErrorResponse } from "../../_auth";
import { getSupabaseAdmin } from "../../_supabaseAdmin";

// The north-star metric: circle completion. A user with 2+ accepted
// contacts is real; a download with an empty circle is nothing. The pair
// is the product, so campaigns are judged by connected pairs created.

export async function GET(req: NextRequest) {
  try {
    await requireAdminSession(req);
    const supabaseAdmin = getSupabaseAdmin();

    const [usersRes, contactsRes, groupsRes, membersRes, presenceRes] = await Promise.all([
      supabaseAdmin
        .from("users")
        .select("id, full_name, avatar_url, created_at")
        .order("created_at", { ascending: false })
        .limit(5000),
      supabaseAdmin
        .from("emergency_contacts")
        .select("user_id, contact_user_id, created_at")
        .eq("status", "accepted")
        .limit(20000),
      supabaseAdmin.from("contact_groups").select("id, owner_id").limit(10000),
      supabaseAdmin
        .from("contact_group_members")
        .select("group_id, member_user_id")
        .eq("status", "accepted")
        .limit(20000),
      supabaseAdmin.from("presence").select("user_id, captured_at").limit(10000),
    ]);

    const users = usersRes.data || [];
    const contacts = contactsRes.data || [];
    const groups = groupsRes.data || [];
    const memberships = membersRes.data || [];
    const presence = new Map((presenceRes.data || []).map((p) => [p.user_id, p.captured_at]));

    // Unique connected pairs: A-B counted once even when both directions
    // exist. Track the EARLIEST link time per pair for growth windows.
    const pairFirstAt = new Map<string, number>();
    // Per-user distinct counterparts (either direction counts as "in
    // your circle": you added them, or they added you).
    const counterparts = new Map<string, Set<string>>();
    for (const c of contacts) {
      const a = c.user_id as string;
      const b = c.contact_user_id as string;
      if (!a || !b || a === b) continue;
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      const t = new Date(c.created_at).getTime();
      const prev = pairFirstAt.get(key);
      if (prev == null || t < prev) pairFirstAt.set(key, t);
      if (!counterparts.has(a)) counterparts.set(a, new Set());
      if (!counterparts.has(b)) counterparts.set(b, new Set());
      counterparts.get(a)!.add(b);
      counterparts.get(b)!.add(a);
    }

    const now = Date.now();
    let pairs7d = 0;
    let pairs30d = 0;
    for (const t of pairFirstAt.values()) {
      if (now - t < 7 * 86400_000) pairs7d++;
      if (now - t < 30 * 86400_000) pairs30d++;
    }

    // Circles per user: groups they own + groups they're an accepted
    // member of.
    const circlesPerUser = new Map<string, number>();
    for (const g of groups) {
      circlesPerUser.set(g.owner_id, (circlesPerUser.get(g.owner_id) || 0) + 1);
    }
    for (const m of memberships) {
      circlesPerUser.set(m.member_user_id, (circlesPerUser.get(m.member_user_id) || 0) + 1);
    }

    let real = 0; // 2+ accepted contacts
    let one = 0;
    let empty = 0;
    const rows = users.map((u) => {
      const n = counterparts.get(u.id)?.size || 0;
      if (n >= 2) real++;
      else if (n === 1) one++;
      else empty++;
      return {
        id: u.id,
        name: u.full_name || "Unknown",
        avatar: u.avatar_url || null,
        joined: u.created_at,
        contacts: n,
        circles: circlesPerUser.get(u.id) || 0,
        lastSeen: presence.get(u.id) || null,
      };
    });
    rows.sort((a, b) => b.contacts - a.contacts);

    return NextResponse.json({
      summary: {
        totalUsers: users.length,
        real,
        one,
        empty,
        completionPct: users.length ? Math.round((real / users.length) * 100) : 0,
        uniquePairs: pairFirstAt.size,
        pairs7d,
        pairs30d,
        totalCircles: groups.length,
      },
      users: rows,
    });
  } catch (error) {
    const authRes = authErrorResponse(error);
    if (authRes) return authRes;
    const msg = error instanceof Error ? error.message : "";
    if (/Admin/i.test(msg)) {
      return NextResponse.json({ error: msg }, { status: 403 });
    }
    console.error("[admin/circle-metrics] error:", error);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}
