"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Eye, MousePointerClick, Share2, Navigation, Megaphone, MoreVertical, Pause, Play, Trash2, CalendarX } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Header } from "@/components/layout/Header";
import { Button } from "@/components/ui/Button";
import { useAuth } from "@/context/AuthContext";
import { authFetchJson } from "@/lib/authFetch";
import { formatNaira, tierSpec, type AdTier, adsEnabled } from "@/lib/ads";

/**
 * What an advertiser sees about their own placements.
 *
 * Counts only, over the last 30 days, and nothing about who the people
 * were. That is the promise made to users in the terms, and the shape of
 * this page is what keeps it.
 */
type Placement = {
  id: string;
  advertiser_id: string;
  tier: AdTier;
  state: string | null;
  lga: string | null;
  status: string;
  auto_renew: boolean;
  rejection_reason: string | null;
  price_naira: number;
  next_charge_at: string | null;
  hidden_at: string | null;
  stats: { impressions: number; taps: number; social: number; directions: number } | null;
};

const STATUS_LABEL: Record<string, string> = {
  awaiting_payment: "Not paid yet",
  pending: "Waiting for review",
  live: "Live",
  paused: "Paused",
  rejected: "Not approved",
  expired: "Finished",
  cancelled: "Cancelled",
};

export default function AdvertiserDashboard() {
  // Advertising is not live yet. Anyone who reaches this by typing the
  // URL or following an old link is sent home rather than shown a
  // half-finished product.
  if (!adsEnabled()) {
    if (typeof window !== "undefined") window.location.replace("/");
    return null;
  }

  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const [placements, setPlacements] = useState<Placement[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  // Per placement, always. Somebody running four adverts who wants to
  // stop one must never be offered a button that stops all four.
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<
    { id: string; action: "cancel" | "delete"; name: string } | null
  >(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [payingId, setPayingId] = useState<string | null>(null);

  /**
   * Apply the change on screen first, then tell the server.
   *
   * Waiting for a round trip before anything moves reads as a dead
   * button: people tap again, and again, because nothing happened. The
   * change is almost always going to succeed, so show it, and put it
   * back if it does not.
   */
  const optimistic = (placementId: string, action: string) =>
    (prev: Placement[]) =>
      prev.flatMap((p) => {
        if (p.id !== placementId) return [p];
        switch (action) {
          case "pause":
            return [{ ...p, status: "paused", auto_renew: false }];
          case "resume":
            return [{ ...p, status: "live" }];
          case "cancel":
            return [{ ...p, auto_renew: false }];
          case "delete":
            // Gone from the list entirely, which is what taking it down
            // looks like from here.
            return [];
          default:
            return [p];
        }
      });

  // Separate from `manage`, which is optimistic. Nothing about a payment
  // should be shown as done before it is: this one leaves the card alone
  // and hands the browser to Paystack.
  const payFor = async (placementId: string) => {
    setPayingId(placementId);
    setError(null);
    try {
      const { res, data } = await authFetchJson("/api/ads/checkout", {
        method: "POST",
        body: JSON.stringify({ placementId }),
      });
      if (!res.ok || !data?.authorizationUrl) {
        setError(data?.error || "Could not start payment. Try again.");
        setPayingId(null);
        return;
      }
      window.location.href = data.authorizationUrl;
    } catch {
      setError("Connection error. Nothing has been charged.");
      setPayingId(null);
    }
  };

  const manage = async (placementId: string, action: string) => {
    const before = placements;
    setPlacements(optimistic(placementId, action));
    setMenuFor(null);
    setConfirm(null);
    setError(null);
    setBusy(true);
    try {
      const { res, data } = await authFetchJson("/api/ads/manage", {
        method: "POST",
        body: JSON.stringify({ placementId, action }),
      });
      if (!res.ok) {
        // Put it back exactly as it was, and say so. Silently reverting
        // would look like the app undid their choice on a whim.
        setPlacements(before);
        setError(data?.error || "That did not go through. Try again.");
        return;
      }
      // Reconcile against the server once it has confirmed, so any field
      // we did not predict (dates, counts) catches up.
      load();
    } catch {
      setPlacements(before);
      setError("Connection error. Nothing was changed.");
    } finally {
      setBusy(false);
    }
  };

  const load = useCallback(async () => {
    try {
      const { res, data } = await authFetchJson("/api/ads/mine");
      if (res.ok && data) {
        setPlacements(data.placements || []);
        const map: Record<string, string> = {};
        for (const a of data.advertisers || []) map[a.id] = a.business_name;
        setNames(map);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!authLoading && !user) { router.replace("/login"); return; }
    if (user) load();
  }, [user, authLoading, router, load]);

  if (authLoading || !user) return null;

  const Stat = ({ icon: Icon, n, label }: { icon: typeof Eye; n: number; label: string }) => (
    <div className="flex-1 min-w-0 text-center">
      <Icon className="w-4 h-4 text-dark-400 mx-auto" />
      <p className="text-lg font-bold text-dark-100 mt-1 tabular-nums">{n.toLocaleString()}</p>
      <p className="text-[10px] uppercase tracking-wide text-dark-500">{label}</p>
    </div>
  );

  return (
    <div className="min-h-screen">
      <Header variant="back" title="My adverts" onBack={() => router.push("/")} />

      <div className="max-w-md mx-auto px-4 pt-app-header-pill pb-24 space-y-4">
        {error && (
          <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/25">
            <p className="text-sm text-red-400">{error}</p>
          </div>
        )}
        {loading ? (
          <p className="text-sm text-dark-500">Loading...</p>
        ) : placements.length === 0 ? (
          <div className="glass-card text-center py-10">
            <div className="mx-auto w-12 h-12 rounded-2xl bg-primary-500/15 flex items-center justify-center mb-3">
              <Megaphone className="w-6 h-6 text-primary-400" />
            </div>
            <p className="text-dark-100 font-medium">Nothing here yet</p>
            <p className="text-sm text-dark-400 mt-1">Put your business on the map.</p>
            <Link href="/advertise">
              <Button size="sm" className="mt-4">Advertise on Peja</Button>
            </Link>
          </div>
        ) : (
          <>
            {placements.map((p) => (
              <div key={p.id} className="glass-card space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-dark-100 font-semibold truncate">
                      {names[p.id] || Object.values(names)[0] || "Your business"}
                    </p>
                    <p className="text-xs text-dark-400 mt-0.5">
                      {tierSpec(p.tier).name} · {p.lga}, {p.state} · {formatNaira(p.price_naira)}/mo
                    </p>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <span
                      className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${
                        p.status === "live" ? "bg-green-500/15 text-green-300"
                        : p.status === "pending" ? "bg-amber-500/15 text-amber-300"
                        : p.status === "awaiting_payment" ? "bg-primary-500/15 text-primary-300"
                        : p.status === "rejected" ? "bg-red-500/15 text-red-300"
                        : "bg-[var(--soft-surface-strong)] text-dark-300"
                      }`}
                    >
                      {STATUS_LABEL[p.status] || p.status}
                    </span>

                    {["live", "paused", "pending"].includes(p.status) && (
                      <div className="relative">
                        <button
                          onClick={() => setMenuFor(menuFor === p.id ? null : p.id)}
                          aria-label="Options"
                          className="p-1.5 rounded-full text-dark-400 hover:text-dark-200 transition-ui"
                        >
                          <MoreVertical className="w-4 h-4" />
                        </button>

                        {/* Tucked in a menu on purpose. Stopping an
                            advert should be findable, not standing next
                            to the numbers inviting a bad day's click. */}
                        {menuFor === p.id && (
                          <>
                            <div className="fixed inset-0 z-40" onClick={() => setMenuFor(null)} />
                            <div
                              className="absolute right-0 top-9 z-50 w-56 rounded-xl overflow-hidden py-1"
                              style={{
                                background: "var(--glass-strong-bg)",
                                border: "1px solid var(--glass-border)",
                                boxShadow: "var(--glass-shadow-strong)",
                              }}
                            >
                              {p.status === "live" && (
                                <button
                                  onClick={() => manage(p.id, "pause")}
                                  disabled={busy}
                                  className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left text-sm text-dark-200 hover:bg-[var(--hairline)]"
                                >
                                  <Pause className="w-4 h-4 shrink-0" /> Pause this advert
                                </button>
                              )}
                              {p.status === "paused" && (
                                <button
                                  onClick={() => manage(p.id, "resume")}
                                  disabled={busy}
                                  className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left text-sm text-dark-200 hover:bg-[var(--hairline)]"
                                >
                                  <Play className="w-4 h-4 shrink-0" /> Put it back up
                                </button>
                              )}
                              {p.status === "live" && p.auto_renew && (
                                <button
                                  onClick={() => {
                                    setMenuFor(null);
                                    setConfirm({ id: p.id, action: "cancel", name: names[p.advertiser_id] || "this advert" });
                                  }}
                                  className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left text-sm text-dark-200 hover:bg-[var(--hairline)]"
                                >
                                  <CalendarX className="w-4 h-4 shrink-0" /> Stop renewing
                                </button>
                              )}
                              <button
                                onClick={() => {
                                  setMenuFor(null);
                                  setConfirm({ id: p.id, action: "delete", name: names[p.advertiser_id] || "this advert" });
                                }}
                                className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left text-xs text-red-400/80 hover:bg-[var(--hairline)]"
                              >
                                <Trash2 className="w-3.5 h-3.5 shrink-0" />
                                {p.status === "pending" ? "Withdraw this advert" : "Take it down"}
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {p.rejection_reason && (
                  <p className="text-xs text-red-400">{p.rejection_reason}</p>
                )}

                {p.status === "awaiting_payment" && (
                  <div className="mt-3 p-3 rounded-xl bg-primary-500/10 border border-primary-500/20">
                    <p className="text-xs text-dark-300 leading-relaxed">
                      This advert has not been paid for, so nobody has reviewed
                      it yet. Finish paying and it goes into review within 24
                      hours.
                    </p>
                    <button
                      onClick={() => payFor(p.id)}
                      disabled={payingId === p.id}
                      className="mt-2.5 w-full py-2.5 rounded-xl text-sm font-semibold bg-primary-600 text-white active:scale-[0.98] transition-ui disabled:opacity-60"
                    >
                      {payingId === p.id ? "Opening payment..." : `Pay ${formatNaira(p.price_naira)}`}
                    </button>
                  </div>
                )}

                {p.hidden_at && p.status === "live" && (
                  <p className="text-xs text-amber-300">
                    Hidden while a payment is outstanding. It comes back as soon as that clears.
                  </p>
                )}

                {p.status === "live" && (
                  <>
                    <div className="flex gap-2 pt-1">
                      <Stat icon={Eye} n={p.stats?.impressions || 0} label="Shown" />
                      <Stat icon={MousePointerClick} n={p.stats?.taps || 0} label="Opened" />
                      <Stat icon={Share2} n={p.stats?.social || 0} label="Socials" />
                      <Stat icon={Navigation} n={p.stats?.directions || 0} label="Directions" />
                    </div>
                    <p className="text-[11px] text-dark-500 text-center">Last 30 days</p>
                  </>
                )}

                {p.status === "live" && p.next_charge_at && (
                  <p className="text-xs text-dark-500">
                    {p.auto_renew
                      ? `Renews ${new Date(p.next_charge_at).toLocaleDateString()}`
                      : `Runs until ${new Date(p.next_charge_at).toLocaleDateString()}, then stops`}
                  </p>
                )}
              </div>
            ))}

            <Link href="/advertise">
              <Button variant="secondary" size="sm" className="w-full">Add another</Button>
            </Link>
          </>
        )}
      </div>

      <Modal
        isOpen={!!confirm}
        onClose={() => setConfirm(null)}
        title={confirm?.action === "cancel" ? "Stop renewing?" : "Take this advert down?"}
      >
        <div className="space-y-4">
          {confirm?.action === "cancel" ? (
            <p className="text-sm text-dark-300 leading-relaxed">
              {confirm.name} keeps running until the end of the period you
              have already paid for, then stops. You will not be charged
              again. Nothing changes for your other adverts.
            </p>
          ) : (
            <p className="text-sm text-dark-300 leading-relaxed">
              {confirm?.name} comes off the map straight away and will not
              renew. The rest of the period you have paid for is not
              refunded, because you are ending it early. Nothing changes for
              your other adverts.
            </p>
          )}

          {confirm?.action === "delete" && (
            <p className="text-xs text-dark-500">
              If you only want a break, pause it instead. A paused advert
              keeps its place and you can put it back up any time.
            </p>
          )}

          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={() => setConfirm(null)}>
              Keep it
            </Button>
            {confirm?.action === "delete" && (
              <Button variant="secondary" size="sm" onClick={() => manage(confirm.id, "pause")} disabled={busy}>
                Pause instead
              </Button>
            )}
            <Button
              size="sm"
              variant={confirm?.action === "delete" ? "danger" : "primary"}
              onClick={() => confirm && manage(confirm.id, confirm.action)}
              disabled={busy}
            >
              {busy ? "..." : confirm?.action === "cancel" ? "Stop renewing" : "Take it down"}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
