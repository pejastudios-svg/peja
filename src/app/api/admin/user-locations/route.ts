import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession, authErrorResponse } from "../../_auth";
import { getSupabaseAdmin } from "../../_supabaseAdmin";

/**
 * Admin map: where people are, sized to what is on screen rather than to
 * how many users exist.
 *
 * Three capture paths feed this and they do not overlap:
 *   presence        written while the app is open (any platform, iOS
 *                   included) AND by the native Android ambient service
 *                   while the app is backgrounded or closed
 *   users.last_*    last deliberate location (post, SOS, check-in)
 *   devices.last_*  the Beacon's own GPS, over GSM, independent of the
 *                   phone entirely
 *
 * Postgres picks the freshest of the three per user (admin_user_positions)
 * so a beacon fix from four minutes ago beats a two-day-old presence row.
 *
 * Three answers, chosen by density, never by guesswork:
 *   points    few enough people in view to draw faces
 *   clusters  too many, so counts per grid cell instead. A view of the
 *             whole country costs a few hundred bytes whether it holds
 *             forty people or four million.
 *   search    ignores the viewport completely. An admin looking for a
 *             name during an incident must find that person whether or
 *             not the map happens to be pointed at them, so this also
 *             returns people we cannot place, with null coordinates.
 *
 * Service-role read: this bypasses the consent-gated RLS on presence by
 * design. requireAdminSession is the gate.
 */

/** Above this many people in view, stop sending faces and send a blob. */
const DETAIL_LIMIT = 400;
const SEARCH_LIMIT = 20;

/** Grid cell size for clustering, as decimal places, from map zoom.
 *  0 is roughly 111km, 4 is roughly 11m. */
function precisionForZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return 1;
  if (zoom < 4) return 0;
  if (zoom < 7) return 1;
  if (zoom < 10) return 2;
  if (zoom < 13) return 3;
  return 4;
}

function num(v: string | null, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

interface PositionRow {
  user_id: string;
  lat: number | null;
  lng: number | null;
  source: string | null;
  captured_at: string | null;
}

export async function GET(req: NextRequest) {
  try {
    await requireAdminSession(req);
    const supabaseAdmin = getSupabaseAdmin();
    const sp = req.nextUrl.searchParams;

    const q = (sp.get("q") || "").trim();

    // ── Search: viewport-independent by design. ──
    if (q) {
      const { data, error } = await supabaseAdmin.rpc("admin_user_search", {
        p_q: q,
        p_limit: SEARCH_LIMIT,
      });
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      const rows = (data as PositionRow[]) || [];
      return NextResponse.json({
        mode: "search",
        users: await hydrate(supabaseAdmin, rows),
      });
    }

    // ── Viewport. Absent bounds means the whole world, which is what the
    //    very first render asks for before the map reports its bounds. ──
    const west = num(sp.get("west"), -180);
    const south = num(sp.get("south"), -90);
    const east = num(sp.get("east"), 180);
    const north = num(sp.get("north"), 90);
    const zoom = num(sp.get("zoom"), 5);
    const bbox = { p_west: west, p_south: south, p_east: east, p_north: north };

    const { data: countData, error: countErr } = await supabaseAdmin.rpc(
      "admin_user_positions_count",
      bbox,
    );
    if (countErr) return NextResponse.json({ error: countErr.message }, { status: 500 });
    const total = Number(countData) || 0;

    // Too dense to draw faces: aggregate in Postgres and send the blob.
    if (total > DETAIL_LIMIT) {
      const { data: cells, error } = await supabaseAdmin.rpc("admin_user_clusters", {
        ...bbox,
        p_precision: precisionForZoom(zoom),
      });
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({
        mode: "clusters",
        total,
        cells: ((cells as { lat: number; lng: number; cnt: number }[]) || []).map((c) => ({
          lat: Number(c.lat),
          lng: Number(c.lng),
          count: Number(c.cnt) || 0,
        })),
      });
    }

    const { data, error } = await supabaseAdmin.rpc("admin_user_positions_bbox", {
      ...bbox,
      p_limit: DETAIL_LIMIT,
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({
      mode: "points",
      total,
      users: await hydrate(supabaseAdmin, (data as PositionRow[]) || []),
    });
  } catch (error) {
    return (
      authErrorResponse(error) ??
      NextResponse.json(
        { error: (error as Error).message },
        { status: (error as Error).message === "Admin required" ? 403 : 500 },
      )
    );
  }
}

/**
 * Turn position rows into the things a human needs to see: name, face,
 * how the fix arrived, whether we will keep hearing from this phone, and
 * the Beacons on the account. Every lookup is batched over exactly the
 * rows being returned, never over the whole user base, which is the
 * property that lets this scale.
 */
async function hydrate(
  supabaseAdmin: ReturnType<typeof getSupabaseAdmin>,
  rows: PositionRow[],
) {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.user_id);

  const [{ data: users }, { data: devices }, { data: keys }, { data: presence }] =
    await Promise.all([
      supabaseAdmin
        .from("users")
        .select("id, full_name, avatar_url, status, is_admin, is_guardian, last_address")
        .in("id", ids),
      supabaseAdmin
        .from("devices")
        .select("id, user_id, name, wearer_name, last_lat, last_lng, last_fix_at, status, active_sos_alert_id")
        .in("user_id", ids)
        .neq("status", "unpaired"),
      // A live key means the native Android service is provisioned: this
      // person keeps reporting with the app shut.
      supabaseAdmin
        .from("device_tracking_keys")
        .select("user_id, last_used_at")
        .in("user_id", ids)
        .is("revoked_at", null),
      supabaseAdmin
        .from("presence")
        .select("user_id, accuracy_m, speed_kmh, heading, still_since, battery_pct")
        .in("user_id", ids),
    ]);

  const userById = new Map((users || []).map((u) => [u.id, u]));
  const presenceById = new Map((presence || []).map((p) => [p.user_id, p]));
  const trackingById = new Map((keys || []).map((k) => [k.user_id, k.last_used_at as string | null]));
  const fleetBy = new Map<string, NonNullable<typeof devices>>();
  for (const d of devices || []) {
    const list = fleetBy.get(d.user_id) || [];
    list.push(d);
    fleetBy.set(d.user_id, list);
  }

  return rows.map((r) => {
    const u = userById.get(r.user_id);
    const p = presenceById.get(r.user_id);
    const fleet = fleetBy.get(r.user_id) || [];
    const onPresence = r.source === "presence";
    return {
      id: r.user_id,
      name: u?.full_name || "Unknown",
      avatar: u?.avatar_url || null,
      status: u?.status || null,
      isAdmin: Boolean(u?.is_admin),
      isGuardian: Boolean(u?.is_guardian),
      // Null for a searched user we cannot place anywhere. The client
      // shows them as unplaceable rather than dropping them.
      lat: r.lat != null ? Number(r.lat) : null,
      lng: r.lng != null ? Number(r.lng) : null,
      source: (r.source || "last_known") as "presence" | "last_known" | "beacon",
      capturedAt: r.captured_at,
      address: r.source === "last_known" ? u?.last_address || null : null,
      accuracyM: onPresence ? p?.accuracy_m ?? null : null,
      speedKmh: onPresence ? p?.speed_kmh ?? null : null,
      heading: onPresence ? p?.heading ?? null : null,
      stillSince: onPresence ? p?.still_since ?? null : null,
      batteryPct: p?.battery_pct ?? null,
      tracking: trackingById.has(r.user_id) ? "background" : "foreground",
      trackingLastBeat: trackingById.get(r.user_id) || null,
      beacons: fleet.map((d) => ({
        id: d.id,
        name: d.wearer_name || d.name,
        lat: d.last_lat != null ? Number(d.last_lat) : null,
        lng: d.last_lng != null ? Number(d.last_lng) : null,
        lastFixAt: d.last_fix_at,
        status: d.status,
        sosActive: Boolean(d.active_sos_alert_id),
      })),
    };
  });
}
