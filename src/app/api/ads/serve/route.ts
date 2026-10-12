import { NextRequest, NextResponse } from "next/server";
import { pinsForViewport, sponsoredForSearch, carouselFor } from "../../_ads";
import { adsEnabled } from "@/lib/ads";

export const runtime = "nodejs";

/**
 * Everything the client needs to draw ads, in one call.
 *
 * Public and unauthenticated: an advert is not private, and requiring a
 * session here would mean the map waits on auth before it can draw.
 *
 * `seed` comes from the client and should be stable for a session. It is
 * what makes the selection hold still while somebody pans around, and
 * differ next time they open the app. Nothing about it identifies a
 * person; it is a shuffle key, not a tracker.
 *
 * Suppression during an SOS or a live nearby incident is done on the
 * CLIENT, which already knows both, rather than here. The map simply
 * does not ask. That is one less thing to get wrong at the moment it
 * matters most.
 */
export async function GET(req: NextRequest) {
  // Feature off. Empty, not an error: a client that still asks should
  // render nothing quietly rather than fill the logs.
  if (!adsEnabled()) {
    return NextResponse.json({ ok: true, pins: [], sponsored: [], carousel: [] });
  }

  const sp = req.nextUrl.searchParams;
  const seed = (sp.get("seed") || "0").slice(0, 64);
  const want = (sp.get("want") || "pins").split(",");

  // Serving is by distance. state/lga are only ever used for selling.
  const lat = Number(sp.get("lat"));
  const lng = Number(sp.get("lng"));
  const hasPoint = Number.isFinite(lat) && Number.isFinite(lng);

  const out: Record<string, unknown> = { ok: true };

  try {
    if (want.includes("pins")) {
      const north = Number(sp.get("north"));
      const south = Number(sp.get("south"));
      const east = Number(sp.get("east"));
      const west = Number(sp.get("west"));
      out.pins =
        [north, south, east, west].every(Number.isFinite)
          ? await pinsForViewport({ north, south, east, west, seed })
          : [];
    }
    if (want.includes("search")) {
      out.sponsored = hasPoint
        ? await sponsoredForSearch({ lat, lng, category: sp.get("category"), seed })
        : [];
    }
    if (want.includes("carousel")) {
      out.carousel = hasPoint ? await carouselFor({ lat, lng, seed }) : [];
    }
    return NextResponse.json(out);
  } catch (e) {
    // An ad failure must never break the surface it sits on. Empty, not an error.
    console.error("[ads/serve]", e);
    return NextResponse.json({ ok: true, pins: [], sponsored: [], carousel: [] });
  }
}
