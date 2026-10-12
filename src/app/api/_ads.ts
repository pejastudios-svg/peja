import { getSupabaseAdmin } from "./_supabaseAdmin";
import {
  DEFAULT_AREA_CAPS,
  MAX_PINS_PER_VIEWPORT,
  PIN_DEDUPE_METRES,
  type AdTier,
  searchTermsFor,
} from "@/lib/ads";

/**
 * Serving and availability logic, shared by the public routes and admin.
 *
 * Two ideas carry most of this file:
 *
 *   Rotation. Far more placements are sold in an area than are ever shown
 *   at once. Which ones a given person sees is decided from a seed tied
 *   to their session, so the selection is stable while they look around
 *   and different the next time. Two people standing together see
 *   different pins, everybody's map stays uncluttered, and across all
 *   sessions every advertiser gets their share.
 *
 *   Scarcity. Caps are per LGA, because a radius cannot answer "how many
 *   are sold here" when every circle overlaps its neighbours. Showing is
 *   done by distance; selling is done by bucket.
 */

export interface ServedPlacement {
  id: string;
  advertiserId: string;
  tier: AdTier;
  businessName: string;
  tagline: string | null;
  category: string;
  logoUrl: string | null;
  socials: Record<string, string>;
  lat: number | null;
  lng: number | null;
  buildingType: string | null;
  bannerText: string | null;
  bannerGradient: string | null;
  // Set when this was shown because the search matched nobody, not
  // because it matched this business. The label changes accordingly.
  isFallback?: boolean;
}

type Row = {
  id: string;
  advertiser_id: string;
  tier: AdTier;
  lat: number | null;
  lng: number | null;
  building_type: string | null;
  banner_text: string | null;
  banner_gradient: string | null;
  advertisers: {
    business_name: string;
    tagline: string | null;
    category: string;
    logo_url: string | null;
    socials: Record<string, string> | null;
    status: string;
  } | null;
};

const SELECT = `
  id, advertiser_id, tier, lat, lng, building_type, banner_text, banner_gradient,
  advertisers!inner ( business_name, tagline, category, logo_url, socials, status )
`;

function shape(r: Row): ServedPlacement {
  const a = r.advertisers!;
  return {
    id: r.id,
    advertiserId: r.advertiser_id,
    tier: r.tier,
    businessName: a.business_name,
    tagline: a.tagline,
    category: a.category,
    logoUrl: a.logo_url,
    socials: a.socials || {},
    lat: r.lat,
    lng: r.lng,
    buildingType: r.building_type,
    bannerText: r.banner_text,
    bannerGradient: r.banner_gradient,
  };
}

/** Deterministic 32-bit hash. Same seed in, same order out. */
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Order placements for one viewer, weighted by tier.
 *
 * Featured appears roughly three times as often as Listed, which is a
 * large part of what the higher tier is actually buying. Weighting the
 * SORT rather than reserving slots means a quiet area with one Featured
 * advertiser still fills both pins instead of leaving one empty.
 */
const TIER_WEIGHT: Record<AdTier, number> = { featured: 3, promoted: 2, listed: 1 };

export function rotate<T extends { id: string; tier: AdTier }>(items: T[], seed: string): T[] {
  return [...items].sort((a, b) => {
    const ra = (hash(seed + a.id) % 1000) / TIER_WEIGHT[a.tier];
    const rb = (hash(seed + b.id) % 1000) / TIER_WEIGHT[b.tier];
    return ra - rb;
  });
}

/** Metres between two coordinates. */
export function metresBetween(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371000;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const la1 = (aLat * Math.PI) / 180;
  const la2 = (bLat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * Sponsored pins for a map viewport.
 *
 * Returns at most two, never two within PIN_DEDUPE_METRES of each other.
 * The dedupe is why a building with ten advertisers shows one pin rather
 * than ten overlapping ones: the slot belongs to the location, and the
 * rotation decides whose turn it is.
 */
export async function pinsForViewport(params: {
  north: number;
  south: number;
  east: number;
  west: number;
  seed: string;
}): Promise<ServedPlacement[]> {
  const supabaseAdmin = getSupabaseAdmin();
  const { data } = await supabaseAdmin
    .from("ad_placements")
    .select(SELECT)
    .eq("status", "live")
    .is("hidden_at", null)
    .gte("lat", params.south)
    .lte("lat", params.north)
    .gte("lng", params.west)
    .lte("lng", params.east)
    // Stable order before rotation. Without it Postgres is free to
    // return these rows in whatever physical order it currently has,
    // which shifts on any insert or vacuum, so the same reader with the
    // same session seed could be shown a different pick from one
    // request to the next. The rotation hash does the shuffling; its
    // input has to hold still for that to mean anything.
    .order("id")
    .limit(300);

  const rows = ((data as unknown as Row[]) || []).filter(
    (r) => r.advertisers?.status === "approved" && r.lat != null && r.lng != null,
  );

  const picked: ServedPlacement[] = [];
  for (const r of rotate(rows, params.seed)) {
    const p = shape(r);
    const clash = picked.some(
      (q) => metresBetween(q.lat!, q.lng!, p.lat!, p.lng!) < PIN_DEDUPE_METRES,
    );
    if (clash) continue;
    picked.push(p);
    if (picked.length >= MAX_PINS_PER_VIEWPORT) break;
  }
  return picked;
}

/**
 * Sponsored results and carousel slides near a point.
 *
 * 25km, which is wide for an advert but right for Lagos: the city is
 * about 70km across and people cross most of it routinely. A tighter
 * radius mostly returned nothing, and the distance is shown on every
 * result anyway, so the viewer can judge for themselves.
 *
 * Serving is by DISTANCE, not by LGA. The bucket exists to answer "how
 * many can be sold here", which overlapping circles cannot. It is the
 * wrong tool for "who is near this person", and using it would mean
 * somebody standing on an LGA boundary never sees the shop across the
 * road. A bounding box needs no boundary data and no lookup table.
 */
/**
 * How long an open checkout keeps its slot reserved.
 *
 * Long enough to finish paying, including a bank's one-time code and a
 * second attempt, and short enough that a closed tab does not sit on a
 * slot anyone else could buy.
 */
const CHECKOUT_HOLD_MS = 2 * 60 * 60 * 1000;

const DEG_PER_KM = 1 / 111;

async function nearby(params: {
  lat: number;
  lng: number;
  radiusKm: number;
  tiers: AdTier[];
}) {
  const supabaseAdmin = getSupabaseAdmin();
  // Longitude degrees shrink with latitude; Nigeria sits near the equator
  // so the correction is small, but it costs nothing to be right.
  const dLat = params.radiusKm * DEG_PER_KM;
  const dLng = dLat / Math.max(0.2, Math.cos((params.lat * Math.PI) / 180));

  const { data } = await supabaseAdmin
    .from("ad_placements")
    .select(SELECT)
    .eq("status", "live")
    .is("hidden_at", null)
    .in("tier", params.tiers)
    .gte("lat", params.lat - dLat)
    .lte("lat", params.lat + dLat)
    .gte("lng", params.lng - dLng)
    .lte("lng", params.lng + dLng)
    .order("id")
    .limit(150);

  return ((data as unknown as Row[]) || []).filter((r) => r.advertisers?.status === "approved");
}

/** Sponsored results for a search, Featured above Promoted. */
export async function sponsoredForSearch(params: {
  lat: number;
  lng: number;
  category?: string | null;
  seed: string;
  radiusKm?: number;
  limit?: number;
}): Promise<ServedPlacement[]> {
  let rows = await nearby({
    lat: params.lat,
    lng: params.lng,
    radiusKm: params.radiusKm ?? 25,
    tiers: ["promoted", "featured"],
  });

  const all = rows;

  if (params.category) {
    // Match on whole words across the name, the category, the tagline
    // and the kind of place, rather than a substring of the category
    // alone. Somebody searching "pharmacy" should find "Mama's Chemist
    // and Pharmacy" whichever field the word happens to sit in.
    const words = params.category.toLowerCase().split(/\s+/).filter((w) => w.length > 1);
    if (words.length) {
      rows = rows.filter((r) => {
        const hay = [
          r.advertisers?.business_name,
          r.advertisers?.category,
          r.advertisers?.tagline,
          // The kind of place, plus the words people really type for
          // it: "food" for a restaurant, "chemist" for a pharmacy.
          ...searchTermsFor(r.building_type),
        ].filter(Boolean).join(" ").toLowerCase();
        return words.some((w) => hay.includes(w));
      });
    }
  }

  // Featured outranks Promoted outright. Within a tier it rotates, so no
  // single business owns the top slot every time.
  const featured = rotate(rows.filter((r) => r.tier === "featured"), params.seed);
  const promoted = rotate(rows.filter((r) => r.tier === "promoted"), params.seed);
  const matched = [...featured, ...promoted];
  if (matched.length) return matched.slice(0, params.limit ?? 3).map(shape);

  // Nothing matched the words. Rather than an empty space, fall back to
  // one nearby Featured business, which is the difference the top tier
  // is paying for: Promoted appears when it is relevant, Featured also
  // appears when the search finds nobody.
  //
  // Just one, and only Featured. A column of unrelated businesses under
  // every failed search is how people learn to scroll past the whole
  // strip, and then none of the tiers are worth anything.
  return rotate(all.filter((r) => r.tier === "featured"), params.seed)
    .slice(0, 1)
    .map((r) => ({ ...shape(r), isFallback: true }));
}

/** Carousel slides near a point. Featured only. */
export async function carouselFor(params: {
  lat: number;
  lng: number;
  seed: string;
  radiusKm?: number;
  limit?: number;
}): Promise<ServedPlacement[]> {
  const rows = await nearby({
    lat: params.lat,
    lng: params.lng,
    radiusKm: params.radiusKm ?? 25,
    tiers: ["featured"],
  });
  return rotate(rows, params.seed).slice(0, params.limit ?? 6).map(shape);
}

/** How many slots are left in an area, and how many are already queuing. */
export async function availability(state: string, lga: string, tier: AdTier) {
  const supabaseAdmin = getSupabaseAdmin();

  const { data: capRow } = await supabaseAdmin
    .from("ad_area_caps")
    .select("max_slots")
    .eq("state", state)
    .eq("lga", lga)
    .eq("tier", tier)
    .maybeSingle();

  const cap = capRow?.max_slots ?? DEFAULT_AREA_CAPS[tier];

  // Pending and paused still hold their slot: a placement awaiting review
  // or one hidden over a failed payment has not given it up.
  //
  // So does a checkout that is still open, but only for CHECKOUT_HOLD_MS.
  // Both halves of that matter. Without the hold, two people can be told
  // the last Featured slot is free, both pay, and one of them has bought
  // something that does not exist. With an unlimited hold, one abandoned
  // cart takes a slot out of a small area until the sweep runs.
  //
  // The hold is not the only guard. /api/ads/checkout asks this again
  // immediately before taking any money, which is what actually closes
  // the race for somebody who wanders back and pays hours later.
  const holdCutoff = new Date(Date.now() - CHECKOUT_HOLD_MS).toISOString();
  const { count: taken } = await supabaseAdmin
    .from("ad_placements")
    .select("*", { count: "exact", head: true })
    .eq("state", state)
    .eq("lga", lga)
    .eq("tier", tier)
    .or(
      `status.in.(pending,approved,live,paused),` +
        `and(status.eq.awaiting_payment,created_at.gt.${holdCutoff})`,
    );

  const { count: queued } = await supabaseAdmin
    .from("ad_queue")
    .select("*", { count: "exact", head: true })
    .eq("state", state)
    .eq("lga", lga)
    .eq("tier", tier)
    .eq("status", "waiting");

  const used = taken || 0;
  return {
    cap,
    used,
    free: Math.max(0, cap - used),
    queued: queued || 0,
    soldOut: used >= cap,
  };
}
