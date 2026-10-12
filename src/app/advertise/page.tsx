"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Check, ChevronDown, Loader2, MapPin, Search, Crosshair, Upload, X } from "lucide-react";
import { Header } from "@/components/layout/Header";
import { Button } from "@/components/ui/Button";
import { useAuth } from "@/context/AuthContext";
import { authFetchJson } from "@/lib/authFetch";
import { AdvertiseIntro, advertiseIntroSkipped } from "@/components/ads/AdvertiseIntro";
import { supabase } from "@/lib/supabase";
import { AdBanner } from "@/components/ads/AdBanner";
import { buildingIcon } from "@/components/ads/buildingIcons";
import { LocationPicker } from "@/components/ads/LocationPicker";
import { areaFromGeocode } from "@/lib/nigeriaMatch";
import { NIGERIA_LGAS, NIGERIA_STATES_LIST } from "@/lib/nigeriaLgas";
import {
  AD_TIERS, BANNER_GRADIENTS, BUILDING_TYPES,
  formatNaira, queueDeposit, tierSpec, type AdTier, adsEnabled,
} from "@/lib/ads";

/**
 * Apply to advertise.
 *
 * One page, because an application split over routes loses people. The
 * intro modal gates it so nobody reaches the form without having been
 * told how review, emergency suppression and the catchment figure work.
 *
 * Note what the tier chooser shows: "Estimated area population", never
 * views or reach. That wording is load-bearing. It is the difference
 * between describing an area and promising traffic, and it is what stops
 * a refund argument in three months.
 */
type Availability = {
  estimatedAreaPopulationLabel: string | null;
  tiers: { tier: AdTier; free: number; queued: number; soldOut: boolean }[];
};

export default function AdvertisePage() {
  // Advertising is not live yet. Anyone who reaches this by typing the
  // URL or following an old link is sent home rather than shown a
  // half-finished product.
  if (!adsEnabled()) {
    if (typeof window !== "undefined") window.location.replace("/");
    return null;
  }

  const router = useRouter();
  const { user, loading: authLoading } = useAuth();

  // null until the "do not show this again" preference has been read.
  // Starting at true flashed the dialog for people who had already
  // dismissed it for good.
  const [intro, setIntro] = useState<boolean | null>(null);
  useEffect(() => {
    setIntro(!advertiseIntroSkipped());
  }, []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<null | {
    queued?: boolean; position?: number; deposit?: number;
    placementId?: string; priceNaira?: number;
  }>(null);
  const [paying, setPaying] = useState(false);

  const [businessName, setBusinessName] = useState("");
  const [category, setCategory] = useState("");
  const [tagline, setTagline] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [logoBusy, setLogoBusy] = useState(false);
  const [isOnlineOnly, setIsOnlineOnly] = useState(false);

  const [state, setState] = useState("Lagos");
  const [lga, setLga] = useState("");
  const [buildingType, setBuildingType] = useState("shop");
  const [lat, setLat] = useState<number | null>(null);
  const [lng, setLng] = useState<number | null>(null);
  const [addressQuery, setAddressQuery] = useState("");
  const [addressLabel, setAddressLabel] = useState("");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<
    { name: string; lat: number; lng: number; state: string | null; lga: string | null }[]
  >([]);
  // Set when the area was filled in from the address rather than by hand,
  // so the form can say so instead of looking like it guessed.
  const [areaAuto, setAreaAuto] = useState(false);

  const [socials, setSocials] = useState<Record<string, string>>({});
  const [contactPhone, setContactPhone] = useState("");

  const [tier, setTier] = useState<AdTier>("promoted");
  const [bannerText, setBannerText] = useState("");
  const [bannerGradient, setBannerGradient] = useState(BANNER_GRADIENTS[0].id as string);
  const [agreed, setAgreed] = useState(false);

  const [avail, setAvail] = useState<Availability | null>(null);

  useEffect(() => {
    if (!authLoading && !user) router.replace("/login");
  }, [user, authLoading, router]);

  // Availability and catchment follow the area, so the tier chooser is
  // never showing numbers for somewhere else.
  useEffect(() => {
    if (!state || !lga) { setAvail(null); return; }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/ads/availability?state=${encodeURIComponent(state)}&lga=${encodeURIComponent(lga)}`);
        const json = await res.json();
        if (!cancelled && json.ok) setAvail(json);
      } catch { /* leave the previous numbers up */ }
    })();
    return () => { cancelled = true; };
  }, [state, lga]);

  // Upload rather than paste a URL. Asking a shop owner for a hosted
  // image URL is asking them to already have a website, which most do
  // not. Compressed in the browser first, so a 2MB phone photo becomes
  // a few hundred KB before it ever leaves the device.
  const MAX_LOGO_BYTES = 2 * 1024 * 1024;

  const uploadLogo = async (file: File) => {
    if (file.size > MAX_LOGO_BYTES) {
      setError("That image is over 2MB. Pick a smaller one.");
      return;
    }
    setLogoBusy(true);
    setError(null);
    try {
      const { compressImage } = await import("@/lib/mediaCompression");
      const small = file.size > 300 * 1024 ? await compressImage(file) : file;

      const { data: auth } = await supabase.auth.getUser();
      const uid = auth.user?.id;
      if (!uid) { setError("Sign in again and retry."); return; }

      const ext = (small.name.split(".").pop() || "jpg").toLowerCase();
      // posts/<uid>/ is the one prefix the browser client is already
      // known to be able to write to.
      const path = `posts/${uid}/logo-${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("media")
        .upload(path, small, { cacheControl: "31536000", upsert: false });
      if (upErr) { setError("Could not upload that. Try again."); return; }

      const { data } = supabase.storage.from("media").getPublicUrl(path);
      setLogoUrl(data.publicUrl);
    } catch {
      setError("Could not upload that. Try again.");
    } finally {
      setLogoBusy(false);
    }
  };

  // Whatever the pin lands on, read the area back off it. Dragging is
  // the reliable way to place a Nigerian address, so it has to fill the
  // area in just as a search result does.
  const resolveArea = useCallback(async (la: number, ln: number) => {
    try {
      const res = await fetch(
        `https://api.maptiler.com/geocoding/${ln},${la}.json` +
          `?key=${process.env.NEXT_PUBLIC_MAPTILER_KEY}&limit=1`,
      );
      const json = await res.json();
      const area = areaFromGeocode(json.features?.[0]?.context);
      if (area.state) {
        setState(area.state);
        setLga(area.lga || "");
        setAreaAuto(Boolean(area.lga));
      }
    } catch {
      /* they can still pick the area by hand */
    }
  }, []);

  const searchAddress = useCallback(async () => {
    const q = addressQuery.trim();
    if (!q) return;
    setSearching(true);
    try {
      const res = await fetch(
        `https://api.maptiler.com/geocoding/${encodeURIComponent(q)}.json` +
        `?key=${process.env.NEXT_PUBLIC_MAPTILER_KEY}&country=ng&limit=5`,
      );
      const json = await res.json();
      setResults(
        (json.features || []).map(
          (f: {
            place_name?: string;
            text?: string;
            center: [number, number];
            context?: Array<{ id?: string; text?: string }>;
          }) => {
            // MapTiler carries the state as `subregion` and the LGA as
            // `joint_municipality`, so the area comes free with the
            // address and nobody has to pick it twice.
            const area = areaFromGeocode(f.context);
            return {
              name: f.place_name || f.text || "",
              lng: f.center[0],
              lat: f.center[1],
              state: area.state,
              lga: area.lga,
            };
          },
        ),
      );
    } catch {
      setError("Could not search that address. Try again.");
    } finally {
      setSearching(false);
    }
  }, [addressQuery]);

  const useMyLocation = () => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      async (p) => {
        setLat(p.coords.latitude);
        setLng(p.coords.longitude);
        setAddressLabel("Your current location");
        setResults([]);
        // Reverse geocode so standing in the shop fills the area in too.
        try {
          const res = await fetch(
            `https://api.maptiler.com/geocoding/${p.coords.longitude},${p.coords.latitude}.json` +
              `?key=${process.env.NEXT_PUBLIC_MAPTILER_KEY}&limit=1`,
          );
          const json = await res.json();
          const area = areaFromGeocode(json.features?.[0]?.context);
          if (area.state) {
            setState(area.state);
            setLga(area.lga || "");
            setAreaAuto(Boolean(area.lga));
          }
        } catch {
          /* they can still pick the area by hand */
        }
      },
      () => setError("Could not get your location. Search for the address instead."),
      { enableHighAccuracy: true, timeout: 15000 },
    );
  };

  const spec = AD_TIERS.find((t) => t.id === tier)!;
  const tierAvail = avail?.tiers.find((t) => t.tier === tier);
  const canSubmit =
    businessName.trim() && category.trim() && state && lga && agreed &&
    (isOnlineOnly || (lat != null && lng != null)) &&
    (!spec.needsBanner || bannerText.trim());

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const { res, data } = await authFetchJson("/api/ads/apply", {
        method: "POST",
        body: JSON.stringify({
          tier, businessName, category, tagline, logoUrl,
          isOnlineOnly, lat, lng, state, lga, buildingType,
          socials, contactPhone, bannerText, bannerGradient,
        }),
      });
      if (!res.ok) { setError(data?.error || "Could not submit"); return; }
      if (data.soldOut) {
        setDone({ queued: true, position: data.queue.position, deposit: data.queue.depositNaira });
      } else {
        setDone({ placementId: data.placementId, priceNaira: data.priceNaira });
      }
    } catch {
      setError("Connection error. Try again.");
    } finally {
      setBusy(false);
    }
  };

  if (authLoading || !user) return null;

  const field = "w-full px-3 glass-input text-sm";
  const label = "block text-sm font-medium text-dark-200 mb-1.5";
  // A native select puts its arrow hard against the right edge, which
  // read as detached from the control. appearance-none plus our own
  // chevron sits it where the padding does.
  const selectField = `${field} appearance-none pr-9`;
  const Chevron = () => (
    <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-dark-400" />
  );

  if (done) {
    return (
      <div className="min-h-screen">
        <Header variant="back" title="Advertise" onBack={() => router.push("/")} />
        <div className="max-w-md mx-auto px-4 pt-app-header-pill pb-10 text-center">
          <div className="mx-auto w-14 h-14 rounded-2xl bg-green-500/15 flex items-center justify-center mb-4">
            <Check className="w-7 h-7 text-green-400" />
          </div>
          {done.queued ? (
            <>
              <h1 className="text-xl font-bold text-dark-50">{lga} is full right now</h1>
              <p className="text-sm text-dark-400 mt-2 leading-relaxed">
                You are number {done.position} in the queue. A deposit of{" "}
                {formatNaira(done.deposit || 0)} holds your place, refundable any
                time before the balance is taken. We will tell you 24 hours
                before anything is charged.
              </p>
            </>
          ) : (
            <>
              <h1 className="text-xl font-bold text-dark-50">Complete your order</h1>
              <p className="text-sm text-dark-400 mt-2 leading-relaxed">
                {tierSpec(tier).name} in {lga} for {formatNaira(done.priceNaira || 0)} a month.
                Pay now and a person reviews it within 24 hours. If we cannot
                approve it, you get every naira back automatically.
              </p>
              <p className="text-xs text-dark-500 mt-3 leading-relaxed">
                You can also cancel yourself for a full refund any time in the
                next 24 hours, as long as it has not gone live.
              </p>
              {error && (
                <p className="text-sm text-red-400 mt-4">{error}</p>
              )}
              <Button
                size="sm"
                className="mt-6 w-full"
                disabled={paying}
                onClick={async () => {
                  setPaying(true);
                  setError(null);
                  try {
                    const { res, data } = await authFetchJson("/api/ads/checkout", {
                      method: "POST",
                      body: JSON.stringify({ placementId: done.placementId }),
                    });
                    if (!res.ok || !data?.authorizationUrl) {
                      setError(data?.error || "Could not start payment. Try again.");
                      setPaying(false);
                      return;
                    }
                    // Leaving the app entirely, so the spinner stays up
                    // until the browser navigates. Clearing it here just
                    // flashes an enabled button on the way out.
                    window.location.href = data.authorizationUrl;
                  } catch {
                    setError("Connection error. Nothing has been charged.");
                    setPaying(false);
                  }
                }}
              >
                {paying ? "Opening payment..." : `Pay ${formatNaira(done.priceNaira || 0)}`}
              </Button>
              <p className="text-[11px] text-dark-500 mt-3">
                Payment is handled by Paystack. Peja never sees your card.
              </p>
            </>
          )}
          <Button
            size="sm"
            variant="ghost"
            className="mt-3"
            onClick={() => router.push("/advertise/dashboard")}
          >
            See my adverts
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <Header variant="back" title="Advertise on Peja" onBack={() => router.push("/")} />

      <AdvertiseIntro
        open={intro === true}
        onAccept={() => setIntro(false)}
        onCancel={() => router.push("/")}
      />

      {intro === false && (
        <div className="max-w-md mx-auto px-4 pt-app-header-pill pb-24 space-y-6">
          {/* Business */}
          <div className="glass-card space-y-4">
            <h2 className="text-sm font-semibold text-dark-400 uppercase">Your business</h2>
            <div>
              <label className={label}>Name</label>
              <input value={businessName} onChange={(e) => setBusinessName(e.target.value.slice(0, 120))} className={field} placeholder="Your business name" />
            </div>
            <div>
              <label className={label}>What you do</label>
              <input value={category} onChange={(e) => setCategory(e.target.value.slice(0, 60))} className={field} placeholder="Pharmacy, salon, restaurant..." />
            </div>
            <div>
              <label className={label}>One line about you <span className="text-dark-500 font-normal">(optional)</span></label>
              <input value={tagline} onChange={(e) => setTagline(e.target.value.slice(0, 140))} className={field} placeholder="What you offer, in one line" />
              <p className="text-[11px] text-dark-500 mt-1 text-right">{tagline.length}/140</p>
            </div>
            <div>
              <label className={label}>Logo <span className="text-dark-500 font-normal">(optional)</span></label>
              {logoUrl ? (
                <div className="flex items-center gap-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={logoUrl} alt="" className="w-16 h-16 rounded-xl object-cover" />
                  <button
                    onClick={() => setLogoUrl("")}
                    className="inline-flex items-center gap-1.5 text-xs text-dark-400 hover:text-dark-200"
                  >
                    <X className="w-3.5 h-3.5" /> Remove
                  </button>
                </div>
              ) : (
                <label className="flex items-center justify-center gap-2 w-full py-6 rounded-xl border border-dashed border-[var(--glass-border)] bg-[var(--glass-input-bg)] cursor-pointer text-sm text-dark-300">
                  {logoBusy ? (
                    <><Loader2 className="w-4 h-4 animate-spin" /> Uploading...</>
                  ) : (
                    <><Upload className="w-4 h-4" /> Choose an image</>
                  )}
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    disabled={logoBusy}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) uploadLogo(f);
                      e.target.value = "";
                    }}
                  />
                </label>
              )}
              <p className="text-[11px] text-dark-500 mt-1.5">
                A square image works best. Up to 2MB.
              </p>
            </div>
          </div>

          {/* Where */}
          <div className="glass-card space-y-4">
            <h2 className="text-sm font-semibold text-dark-400 uppercase">Where you are</h2>

            <label className="flex items-center gap-2.5 text-sm text-dark-200">
              <input type="checkbox" checked={isOnlineOnly} onChange={(e) => setIsOnlineOnly(e.target.checked)} />
              Online only, no physical address
            </label>

            {!isOnlineOnly && (
              <>
                <div>
                  <label className={label}>Find your address</label>
                  <div className="flex gap-2">
                    <input
                      value={addressQuery}
                      onChange={(e) => setAddressQuery(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") searchAddress(); }}
                      className={field}
                      placeholder="Area or street, e.g. Okota"
                    />
                    <Button variant="secondary" size="sm" onClick={searchAddress} disabled={searching}>
                      {searching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                    </Button>
                  </div>
                  <p className="text-[11px] text-dark-500 mt-1.5">
                    Search the area or the road. House numbers are usually not
                    on the map, so place the exact spot below.
                  </p>
                  <button onClick={useMyLocation} className="mt-2 text-xs text-primary-400 inline-flex items-center gap-1.5">
                    <Crosshair className="w-3.5 h-3.5" /> I am at my business now
                  </button>
                </div>

                {results.length > 0 && (
                  <div className="space-y-1.5">
                    {results.map((r, i) => (
                      <button
                        key={i}
                        onClick={() => {
                          setLat(r.lat);
                          setLng(r.lng);
                          setAddressLabel(r.name);
                          setResults([]);
                          // Only when the geocoder was confident enough to
                          // match a real LGA. A wrong area assigned quietly
                          // would sell a placement in the wrong place, so
                          // an unmatched one is left for them to pick.
                          if (r.state) {
                            setState(r.state);
                            setLga(r.lga || "");
                            setAreaAuto(Boolean(r.lga));
                          }
                        }}
                        className="w-full text-left px-3 py-2.5 rounded-xl bg-[var(--glass-input-bg)] border border-[var(--glass-border)] text-sm text-dark-200"
                      >
                        {r.name}
                      </button>
                    ))}
                  </div>
                )}

                {lat != null && lng != null && (
                  <>
                    {addressLabel && (
                      <p className="text-xs text-green-400 flex items-center gap-1.5">
                        <MapPin className="w-3.5 h-3.5 shrink-0" />
                        <span className="truncate">{addressLabel}</span>
                      </p>
                    )}
                    <LocationPicker
                      lat={lat}
                      lng={lng}
                      onChange={(la, ln) => {
                        setLat(la);
                        setLng(ln);
                        setAddressLabel("");
                        resolveArea(la, ln);
                      }}
                    />
                  </>
                )}

                {/* Nothing picked yet: offer the map anyway, centred on
                    Lagos, so somebody whose address simply is not in the
                    data is never stuck at a dead search box. */}
                {(lat == null || lng == null) && (
                  <button
                    type="button"
                    onClick={() => { setLat(6.5244); setLng(3.3792); setAddressLabel(""); }}
                    className="w-full py-3 rounded-xl border border-dashed border-[var(--glass-border)] bg-[var(--glass-input-bg)] text-sm text-dark-300"
                  >
                    Or place it on the map yourself
                  </button>
                )}

                <div>
                  <label className={label}>Kind of place</label>
                  {/* A grid, not a dropdown. This choice IS the pin that
                      appears on the map, so showing the pins is the only
                      honest way to ask. */}
                  <div className="grid grid-cols-4 gap-1.5">
                    {BUILDING_TYPES.map((b) => {
                      const Icon = buildingIcon(b.id);
                      const on = buildingType === b.id;
                      return (
                        <button
                          key={b.id}
                          type="button"
                          onClick={() => setBuildingType(b.id)}
                          className={`flex flex-col items-center gap-1 py-2.5 px-1 rounded-xl border transition-ui ${
                            on
                              ? "border-primary-500/50 bg-primary-500/10"
                              : "border-[var(--glass-border)] bg-[var(--glass-input-bg)]"
                          }`}
                        >
                          <Icon className={`w-[18px] h-[18px] ${on ? "beacon-accent-text" : "text-dark-400"}`} />
                          <span className={`text-[10px] leading-tight text-center ${on ? "text-dark-100" : "text-dark-400"}`}>
                            {b.label}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                  <p className="text-[11px] text-dark-500 mt-1.5">
                    This is the pin people will see on the map.
                  </p>
                </div>
              </>
            )}

            {areaAuto && (
              <p className="text-[11px] text-green-400">
                Area filled in from your address. Change it if it is wrong.
              </p>
            )}

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className={label}>State</label>
                <div className="relative">
                  <select value={state} onChange={(e) => { setState(e.target.value); setLga(""); setAreaAuto(false); }} className={selectField}>
                    {NIGERIA_STATES_LIST.map((st) => <option key={st} value={st}>{st}</option>)}
                  </select>
                  <Chevron />
                </div>
              </div>
              <div>
                <label className={label}>Area</label>
                <div className="relative">
                  <select value={lga} onChange={(e) => { setLga(e.target.value); setAreaAuto(false); }} className={selectField}>
                    <option value="">Choose</option>
                    {(NIGERIA_LGAS[state] || []).map((l) => <option key={l} value={l}>{l}</option>)}
                  </select>
                  <Chevron />
                </div>
              </div>
            </div>
          </div>

          {/* Socials */}
          <div className="glass-card space-y-3">
            <h2 className="text-sm font-semibold text-dark-400 uppercase">How people reach you</h2>
            {["whatsapp", "instagram", "facebook", "tiktok", "website"].map((k) => (
              <div key={k}>
                <label className={`${label} capitalize`}>{k} <span className="text-dark-500 font-normal">(optional)</span></label>
                <input
                  value={socials[k] || ""}
                  onChange={(e) => setSocials((s) => ({ ...s, [k]: e.target.value }))}
                  className={field}
                  placeholder={k === "whatsapp" ? "08012345678" : k === "website" ? "yoursite.com" : "@yourhandle"}
                />
              </div>
            ))}
            <div>
              <label className={label}>Phone we can reach you on</label>
              <input value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} className={field} placeholder="08012345678" />
            </div>
          </div>

          {/* Plan */}
          <div className="glass-card space-y-3">
            <h2 className="text-sm font-semibold text-dark-400 uppercase">Choose your plan</h2>

            {lga && avail?.estimatedAreaPopulationLabel && (
              <div className="p-3 rounded-xl bg-primary-500/10 border border-primary-500/25">
                <p className="text-sm text-dark-100">
                  <span className="font-semibold">{avail.estimatedAreaPopulationLabel}</span> people in {lga}
                </p>
                <p className="text-[11px] text-dark-400 mt-0.5">
                  Estimated area population
                </p>
              </div>
            )}

            {AD_TIERS.map((t) => {
              const a = avail?.tiers.find((x) => x.tier === t.id);
              const selected = tier === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => setTier(t.id)}
                  className={`w-full text-left p-4 rounded-xl border transition-ui ${
                    selected
                      ? "border-primary-500/50 bg-primary-500/10"
                      : "border-[var(--glass-border)] bg-[var(--glass-input-bg)]"
                  }`}
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-dark-100 font-semibold">{t.name}</span>
                    <span className="text-dark-100 font-bold">{formatNaira(t.priceNaira)}<span className="text-xs text-dark-400 font-normal">/mo</span></span>
                  </div>
                  <p className="text-xs text-dark-400 mt-0.5">{t.summary}</p>
                  <ul className="mt-2 space-y-0.5">
                    {t.includes.map((i) => (
                      <li key={i} className="text-xs text-dark-300">· {i}</li>
                    ))}
                  </ul>
                  {a && (
                    <p className={`text-[11px] mt-2 ${a.soldOut ? "text-amber-300" : "text-dark-500"}`}>
                      {a.soldOut
                        ? `Full. ${a.queued} waiting. Deposit ${formatNaira(queueDeposit(t.id))} to join.`
                        : `${a.free} ${a.free === 1 ? "place" : "places"} left in ${lga}`}
                    </p>
                  )}
                </button>
              );
            })}
          </div>

          {/* Banner, Featured only */}
          {spec.needsBanner && (
            <div className="glass-card space-y-3">
              <h2 className="text-sm font-semibold text-dark-400 uppercase">Your banner</h2>
              <p className="text-xs text-dark-500">
                Pick a colour and write one line. We build the banner.
              </p>
              <input
                value={bannerText}
                onChange={(e) => setBannerText(e.target.value.slice(0, 80))}
                className={field}
                placeholder="Open 7am to 10pm, free delivery nearby"
              />
              <div className="flex flex-wrap gap-2">
                {BANNER_GRADIENTS.map((g) => (
                  <button
                    key={g.id}
                    onClick={() => setBannerGradient(g.id)}
                    aria-label={g.label}
                    className={`w-10 h-10 rounded-xl transition-transform active:scale-95 ${
                      bannerGradient === g.id ? "ring-2 ring-primary-400 ring-offset-2 ring-offset-transparent" : ""
                    }`}
                    style={{ background: g.css, border: "1px solid var(--glass-border)" }}
                  />
                ))}
              </div>
              <AdBanner businessName={businessName || "Your business"} text={bannerText} gradient={bannerGradient} logoUrl={logoUrl || null} />
            </div>
          )}

          <label className="flex items-start gap-2.5 text-sm text-dark-300">
            <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="mt-1 shrink-0" />
            <span>
              I agree to the{" "}
              <Link href="/terms" className="text-primary-400">advertiser terms</Link>, and confirm my
              business is none of the categories Peja does not carry.
            </span>
          </label>

          {error && <p className="text-sm text-red-400">{error}</p>}

          <Button onClick={submit} disabled={busy || !canSubmit} className="w-full">
            {busy ? "Sending..." : tierAvail?.soldOut ? "Join the queue" : "Send for review"}
          </Button>
          <p className="text-[11px] text-dark-500 text-center">
            Nothing is charged until a person approves your advert.
          </p>
        </div>
      )}
    </div>
  );
}
