import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession, authErrorResponse } from "../../_auth";
import { getSupabaseAdmin } from "../../_supabaseAdmin";
import { verifyPin } from "@/lib/adminSession";
import { isRateLimitedDurable } from "../../_rateLimit";

/**
 * Beacon picture for ONE user, for the admin profile page.
 *
 * Two directions, because "connected to an account" means both:
 *   owned   - devices this user pairs and pays for, with the full
 *             visibility list (who can see this device, and who is
 *             explicitly blocked from seeing it)
 *   visible - devices someone ELSE owns that this user can see, either
 *             by an explicit Beacon Circle grant or by being an accepted
 *             emergency contact of an owner who shares with contacts
 *
 * SIM numbers are secrets (knowing one lets you reconfigure the device by
 * SMS), so only the last four digits leave this route.
 */

function simLast4(msisdn: string | null | undefined): string | null {
  if (!msisdn) return null;
  const digits = String(msisdn).replace(/\D/g, "");
  return digits.length >= 4 ? digits.slice(-4) : null;
}

const DEVICE_COLS =
  "id, user_id, device_id, name, wearer_name, wearer_color, status, battery_pct, last_lat, last_lng, last_fix_at, last_seen_at, active_sos_alert_id, share_with_contacts, fall_alert_enabled, firmware, sim_msisdn, created_at";

export async function GET(req: NextRequest) {
  try {
    await requireAdminSession(req);
    const userId = req.nextUrl.searchParams.get("userId");
    if (!userId) {
      return NextResponse.json({ error: "userId required" }, { status: 400 });
    }
    const supabaseAdmin = getSupabaseAdmin();

    // Owned devices, plus every grant that names this user as a viewer.
    const [{ data: owned }, { data: grantsToUser }] = await Promise.all([
      supabaseAdmin
        .from("devices")
        .select(DEVICE_COLS)
        .eq("user_id", userId)
        .neq("status", "unpaired"),
      supabaseAdmin
        .from("beacon_viewers")
        .select("device_id, created_at")
        .eq("viewer_user_id", userId),
    ]);

    const ownedIds = (owned || []).map((d) => d.id);

    // Visibility list for the owned devices: explicit grants and the
    // per-person exclusions, names resolved in one batch.
    const [{ data: grants }, { data: hidden }, { data: contacts }] = await Promise.all([
      ownedIds.length
        ? supabaseAdmin
            .from("beacon_viewers")
            .select("device_id, viewer_user_id, created_at")
            .in("device_id", ownedIds)
        : Promise.resolve({ data: [] as { device_id: string; viewer_user_id: string; created_at: string }[] }),
      ownedIds.length
        ? supabaseAdmin
            .from("device_hidden_contacts")
            .select("device_id, contact_user_id")
            .in("device_id", ownedIds)
        : Promise.resolve({ data: [] as { device_id: string; contact_user_id: string }[] }),
      // Accepted contacts of this user: they see share_with_contacts
      // devices unless individually hidden.
      supabaseAdmin
        .from("emergency_contacts")
        .select("contact_user_id")
        .eq("user_id", userId)
        .eq("status", "accepted"),
    ]);

    // Devices this user can see that they do NOT own.
    const grantedIds = (grantsToUser || []).map((g) => g.device_id).filter((id) => !ownedIds.includes(id));
    const { data: sharedDevices } = grantedIds.length
      ? await supabaseAdmin.from("devices").select(DEVICE_COLS).in("id", grantedIds)
      : { data: [] as NonNullable<typeof owned> };

    // Resolve every name we are about to print, in one query.
    const peopleIds = [
      ...new Set([
        ...(grants || []).map((g) => g.viewer_user_id),
        ...(hidden || []).map((h) => h.contact_user_id),
        ...(contacts || []).map((c) => c.contact_user_id),
        ...(sharedDevices || []).map((d) => d.user_id),
      ]),
    ].filter(Boolean);
    const { data: people } = peopleIds.length
      ? await supabaseAdmin.from("users").select("id, full_name, avatar_url").in("id", peopleIds)
      : { data: [] as { id: string; full_name: string | null; avatar_url: string | null }[] };
    const personById = new Map((people || []).map((p) => [p.id, p]));
    const nameOf = (id: string) => personById.get(id)?.full_name || "Unknown";

    const grantsBy = new Map<string, { id: string; name: string; grantedAt: string }[]>();
    for (const g of grants || []) {
      const list = grantsBy.get(g.device_id) || [];
      list.push({ id: g.viewer_user_id, name: nameOf(g.viewer_user_id), grantedAt: g.created_at });
      grantsBy.set(g.device_id, list);
    }
    const hiddenBy = new Map<string, { id: string; name: string }[]>();
    for (const h of hidden || []) {
      const list = hiddenBy.get(h.device_id) || [];
      list.push({ id: h.contact_user_id, name: nameOf(h.contact_user_id) });
      hiddenBy.set(h.device_id, list);
    }
    const acceptedContacts = (contacts || []).map((c) => ({
      id: c.contact_user_id,
      name: nameOf(c.contact_user_id),
    }));

    const shape = (d: NonNullable<typeof owned>[number]) => ({
      id: d.id,
      deviceId: d.device_id,
      name: d.name,
      wearerName: d.wearer_name || null,
      wearerColor: d.wearer_color || null,
      status: d.status,
      batteryPct: d.battery_pct,
      lat: d.last_lat != null ? Number(d.last_lat) : null,
      lng: d.last_lng != null ? Number(d.last_lng) : null,
      lastFixAt: d.last_fix_at,
      lastSeenAt: d.last_seen_at,
      sosActive: Boolean(d.active_sos_alert_id),
      shareWithContacts: Boolean(d.share_with_contacts),
      fallAlertEnabled: Boolean(d.fall_alert_enabled),
      firmware: d.firmware || null,
      simLast4: simLast4(d.sim_msisdn),
      pairedAt: d.created_at,
    });

    return NextResponse.json({
      owned: (owned || []).map((d) => {
        const explicit = grantsBy.get(d.id) || [];
        const blocked = hiddenBy.get(d.id) || [];
        const blockedIds = new Set(blocked.map((b) => b.id));
        // Contacts only see it if the device shares with contacts at all,
        // and they are not on the block list for this device.
        const viaContacts = d.share_with_contacts
          ? acceptedContacts.filter((c) => !blockedIds.has(c.id))
          : [];
        // One person can be both granted and a contact; count them once.
        const seenIds = new Set<string>();
        const canSee = [
          ...explicit.map((e) => ({ ...e, via: "grant" as const })),
          ...viaContacts.map((c) => ({ ...c, grantedAt: null, via: "contact" as const })),
        ].filter((p) => (seenIds.has(p.id) ? false : (seenIds.add(p.id), true)));
        return { ...shape(d), canSee, hiddenFrom: blocked };
      }),
      visible: (sharedDevices || []).map((d) => ({
        ...shape(d),
        ownerId: d.user_id,
        ownerName: nameOf(d.user_id),
        ownerAvatar: personById.get(d.user_id)?.avatar_url || null,
        grantedAt: (grantsToUser || []).find((g) => g.device_id === d.id)?.created_at || null,
      })),
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
 * Reveal one device's full SIM number, behind a fresh admin PIN.
 *
 * On this hardware the SIM number is not contact information, it is the
 * control channel: /api/beacon/sms texts commands straight to it, and
 * the device's own authorisation code is the factory default. Anyone
 * holding the number can repoint a Beacon's SOS call at their own phone.
 * So it is treated the way the election danger zone treats deletion: the
 * admin session cookie alone is not enough, the dashboard PIN is checked
 * again at the moment of use, and every reveal is written to the audit
 * log whether it succeeded or not.
 */
export async function POST(req: NextRequest) {
  try {
    const { user } = await requireAdminSession(req);
    const supabaseAdmin = getSupabaseAdmin();
    const { action, deviceId, pin } = await req.json();

    if (action !== "reveal_sim") {
      return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
    if (!deviceId || typeof deviceId !== "string") {
      return NextResponse.json({ error: "deviceId required" }, { status: 400 });
    }

    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      req.headers.get("x-real-ip") ||
      "unknown";
    const ua = req.headers.get("user-agent") || "unknown";
    const log = (ok: boolean) =>
      supabaseAdmin.from("admin_access_log").insert({
        user_id: user.id,
        action: ok ? "sim_revealed" : "sim_reveal_failed",
        ip_address: ip,
        user_agent: ua,
        metadata: { device_id: deviceId },
      });

    // Slow a brute force through this door specifically; the dashboard
    // PIN's own lockout still applies to the main gate.
    if (await isRateLimitedDurable(`sim-reveal:${user.id}`, 10, 900)) {
      return NextResponse.json(
        { error: "Too many attempts. Wait a few minutes." },
        { status: 429 },
      );
    }

    const storedHash = process.env.ADMIN_PIN_HASH;
    if (!storedHash) {
      return NextResponse.json({ error: "Server mis-configured" }, { status: 500 });
    }
    if (!pin || typeof pin !== "string" || !verifyPin(pin, storedHash)) {
      await log(false);
      return NextResponse.json({ error: "Incorrect PIN" }, { status: 401 });
    }

    const { data: device } = await supabaseAdmin
      .from("devices")
      .select("id, sim_msisdn")
      .eq("id", deviceId)
      .maybeSingle();
    if (!device) {
      return NextResponse.json({ error: "Device not found" }, { status: 404 });
    }

    await log(true);
    return NextResponse.json({ ok: true, sim: device.sim_msisdn });
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
