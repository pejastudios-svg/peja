"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { apiUrl } from "@/lib/api";
import HudShell from "@/components/dashboard/HudShell";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { AdBanner } from "@/components/ads/AdBanner";
import { Check, X, Pause, Play, AlertTriangle, CloudOff } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { PROHIBITED_CATEGORIES, tierSpec, formatNaira, type AdTier } from "@/lib/ads";
import { PejaSpinner } from "@/components/ui/PejaSpinner";
import { catchmentFor, formatCatchment } from "@/lib/lgaCatchment";
import { NIGERIA_LGAS, NIGERIA_STATES_LIST } from "@/lib/nigeriaLgas";

/**
 * Advert review.
 *
 * Nothing reaches the map without passing through this screen. The
 * prohibited-category list is rendered as a checklist that has to be
 * ticked before Approve becomes available, which turns approval into a
 * deliberate act rather than a reflex. Betting and loan apps will be the
 * highest bidders here, and a tired admin at midnight is exactly who that
 * checklist is for.
 */
type Row = {
  id: string;
  tier: AdTier;
  state: string | null;
  lga: string | null;
  building_type: string | null;
  banner_text: string | null;
  banner_gradient: string | null;
  status: string;
  rejection_reason: string | null;
  price_naira: number;
  lat: number | null;
  lng: number | null;
  created_at: string;
  advertisers: {
    id: string;
    business_name: string;
    category: string;
    tagline: string | null;
    logo_url: string | null;
    socials: Record<string, string> | null;
    contact_email: string | null;
    contact_phone: string | null;
    is_online_only: boolean;
    status: string;
  } | null;
};

const TABS = [
  { key: "pending", label: "To review" },
  { key: "live", label: "Live" },
  { key: "rejected", label: "Rejected" },
  { key: "paused", label: "Paused" },
  { key: "outages", label: "Outages" },
  { key: "money", label: "Money" },
] as const;

type Revenue = {
  counts: Record<string, number>;
  byTier: Record<string, number>;
  revenue: {
    grossNaira: number; refundedNaira: number; netNaira: number;
    thisMonthNaira: number; unpaidCheckoutsNaira: number;
  };
};

type Outage = {
  id: string;
  started_at: string;
  ended_at: string;
  scope: string;
  scope_state: string | null;
  scope_lga: string | null;
  scope_tier: string | null;
  reason: string;
  applied_at: string | null;
  placements_credited: number;
  days_credited: number;
};

export default function AdminAdsPage() {
  const [tab, setTab] = useState<(typeof TABS)[number]["key"]>("pending");
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [rejecting, setRejecting] = useState<Row | null>(null);
  const [reason, setReason] = useState("");
  const [note, setNote] = useState<string | null>(null);
  // How many sit behind each tab. Carried on the list response rather
  // than fetched separately, so the badge can never disagree with the
  // rows underneath it.
  const [counts, setCounts] = useState<Record<string, number>>({});

  // Outage reporting. One declaration credits everyone who was live in
  // the window, however many that is, so this never becomes a list to
  // work through by hand.
  const [outages, setOutages] = useState<Outage[]>([]);
  const [oStart, setOStart] = useState("");
  const [oEnd, setOEnd] = useState("");
  const [oReason, setOReason] = useState("");
  const [oScope, setOScope] = useState<"all" | "state" | "lga" | "tier">("all");
  const [oState, setOState] = useState("Lagos");
  const [oLga, setOLga] = useState("");
  const [oTier, setOTier] = useState<AdTier>("featured");
  const [confirmOutage, setConfirmOutage] = useState(false);
  const [money, setMoney] = useState<Revenue | null>(null);

  const token = async () => (await supabase.auth.getSession()).data.session?.access_token || "";

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(apiUrl(`/api/admin/ads?status=${tab}`), {
        headers: { Authorization: `Bearer ${await token()}` },
      });
      const json = await res.json();
      if (res.ok) {
        setRows(json.placements || []);
        if (json.counts) setCounts(json.counts);
      }
    } finally {
      setLoading(false);
      setChecked(false);
    }
  }, [tab]);

  const loadOutages = useCallback(async () => {
    try {
      const res = await fetch(apiUrl("/api/admin/ads/outage"), {
        headers: { Authorization: `Bearer ${await token()}` },
      });
      const json = await res.json();
      if (res.ok) setOutages(json.outages || []);
    } catch { /* leave the list as it was */ }
  }, []);

  const loadMoney = useCallback(async () => {
    try {
      const res = await fetch(apiUrl("/api/admin/ads/revenue"), {
        headers: { Authorization: `Bearer ${await token()}` },
      });
      const json = await res.json();
      if (res.ok) setMoney(json);
    } catch { /* leave the last figures up rather than blanking them */ }
  }, []);

  useEffect(() => {
    if (tab === "outages") { loadOutages(); setLoading(false); }
    else if (tab === "money") { loadMoney(); setLoading(false); }
    else load();
  }, [tab, load, loadOutages, loadMoney]);

  const reportOutage = async () => {
    setBusy(true);
    try {
      const res = await fetch(apiUrl("/api/admin/ads/outage"), {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${await token()}` },
        body: JSON.stringify({
          startedAt: new Date(oStart).toISOString(),
          endedAt: new Date(oEnd).toISOString(),
          reason: oReason,
          scope: oScope,
          scopeState: oScope === "state" || oScope === "lga" ? oState : null,
          scopeLga: oScope === "lga" ? oLga : null,
          scopeTier: oScope === "tier" ? oTier : null,
        }),
      });
      const json = await res.json();
      if (!res.ok) { setNote(json.error || "Could not apply"); return; }
      setNote(
        json.placements === 0
          ? "Nothing was live in that window, so nobody was credited."
          : `Credited ${json.placements} ${json.placements === 1 ? "advert" : "adverts"}, ${json.days} days in total. They have been told.`,
      );
      setConfirmOutage(false);
      setOStart(""); setOEnd(""); setOReason("");
      loadOutages();
    } finally {
      setBusy(false);
    }
  };

  const act = async (placementId: string, action: string, why?: string) => {
    setBusy(true);
    try {
      const res = await fetch(apiUrl("/api/admin/ads"), {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${await token()}` },
        body: JSON.stringify({ placementId, action, reason: why }),
      });
      if (res.ok) {
        setNote(
          action === "approve" ? "Approved and live."
          : action === "reject" ? "Rejected. They have been told."
          : action === "pause" ? "Paused."
          : "Back live.",
        );
        setRejecting(null);
        setReason("");
        load();
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <HudShell title="Adverts" subtitle="Nothing goes on the map until it is approved here">
      <div className="max-w-3xl mx-auto">
        {note && (
          <div className="glass-card mb-4 flex items-center gap-2.5">
            <Check className="w-5 h-5 text-green-400 shrink-0" />
            <p className="text-sm text-dark-200">{note}</p>
          </div>
        )}

        <div className="flex gap-1.5 mb-5 flex-wrap">
          {TABS.map((t) => {
            const n = counts[t.key];
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-sm border transition-ui ${
                  tab === t.key
                    ? "border-primary-500/50 bg-primary-500/10 text-dark-100"
                    : "border-[var(--glass-border)] bg-[var(--glass-input-bg)] text-dark-300"
                }`}
              >
                {t.label}
                {typeof n === "number" && n > 0 && (
                  <span
                    className={`min-w-[18px] px-1 h-[18px] rounded-full text-[10px] font-bold flex items-center justify-center ${
                      t.key === "pending"
                        ? "bg-amber-500/20 text-amber-300"
                        : "bg-[var(--soft-surface-strong)] text-dark-300"
                    }`}
                  >
                    {n}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {tab === "money" ? (
          !money ? (
            <div className="flex justify-center py-12"><PejaSpinner /></div>
          ) : (
            <div className="space-y-4">
              <div className="glass-card">
                <p className="text-xs uppercase tracking-wide text-dark-500 mb-3">Money</p>
                <div className="grid grid-cols-2 gap-3">
                  <Stat label="Received, all time" value={formatNaira(money.revenue.grossNaira)} />
                  <Stat label="This month" value={formatNaira(money.revenue.thisMonthNaira)} />
                  <Stat label="Refunded" value={formatNaira(money.revenue.refundedNaira)} tone="amber" />
                  <Stat label="Net kept" value={formatNaira(money.revenue.netNaira)} tone="green" />
                </div>
                {money.revenue.unpaidCheckoutsNaira > 0 && (
                  <p className="text-xs text-dark-500 mt-3 leading-relaxed">
                    {formatNaira(money.revenue.unpaidCheckoutsNaira)} sits in checkouts
                    nobody finished. Not money owed, just people who reached the
                    payment screen and stopped.
                  </p>
                )}
                <p className="text-[11px] text-dark-500 mt-3 leading-relaxed">
                  Before Paystack takes its cut. They charge 1.5% plus ₦100,
                  capped at ₦2,000, and 7.5% VAT on that fee.
                </p>
              </div>

              <div className="glass-card">
                <p className="text-xs uppercase tracking-wide text-dark-500 mb-3">Running now</p>
                <div className="grid grid-cols-3 gap-3">
                  <Stat label="Listed" value={String(money.byTier.listed)} />
                  <Stat label="Promoted" value={String(money.byTier.promoted)} />
                  <Stat label="Featured" value={String(money.byTier.featured)} />
                </div>
              </div>

              <div className="glass-card">
                <p className="text-xs uppercase tracking-wide text-dark-500 mb-3">
                  Every advert ever ({money.counts.total})
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <Stat label="Live" value={String(money.counts.live)} tone="green" />
                  <Stat label="Waiting for review" value={String(money.counts.pending)} tone="amber" />
                  <Stat label="Payment overdue" value={String(money.counts.overdue)} tone={money.counts.overdue > 0 ? "red" : undefined} />
                  <Stat label="Never paid" value={String(money.counts.awaitingPayment)} />
                  <Stat label="Paused" value={String(money.counts.paused)} />
                  <Stat label="Not approved" value={String(money.counts.rejected)} />
                  <Stat label="Finished" value={String(money.counts.expired)} />
                  <Stat label="Cancelled" value={String(money.counts.cancelled)} />
                </div>
              </div>
            </div>
          )
        ) : tab === "outages" ? (
          <div className="space-y-5">
            <div className="glass-card space-y-4">
              <div className="flex items-start gap-2.5">
                <CloudOff className="w-5 h-5 text-amber-300 shrink-0 mt-0.5" />
                <p className="text-xs text-dark-300 leading-relaxed">
                  Report a window where adverts were not showing properly. Everyone
                  who was live during it gets those days added to the end of their
                  placement, and is told. No money leaves Peja.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-sm font-medium text-dark-200 mb-1.5">From</label>
                  <input type="datetime-local" value={oStart} onChange={(e) => setOStart(e.target.value)} className="w-full px-3 glass-input text-sm" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-dark-200 mb-1.5">To</label>
                  <input type="datetime-local" value={oEnd} onChange={(e) => setOEnd(e.target.value)} className="w-full px-3 glass-input text-sm" />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-dark-200 mb-1.5">Who it affected</label>
                <div className="flex gap-1.5 flex-wrap">
                  {(["all", "state", "lga", "tier"] as const).map((k) => (
                    <button
                      key={k}
                      onClick={() => setOScope(k)}
                      className={`px-3 py-1.5 rounded-xl text-xs border capitalize transition-ui ${
                        oScope === k
                          ? "border-primary-500/50 bg-primary-500/10 text-dark-100"
                          : "border-[var(--glass-border)] bg-[var(--glass-input-bg)] text-dark-300"
                      }`}
                    >
                      {k === "all" ? "Everyone" : k === "lga" ? "One area" : `By ${k}`}
                    </button>
                  ))}
                </div>
              </div>

              {(oScope === "state" || oScope === "lga") && (
                <div className="grid grid-cols-2 gap-2">
                  <select value={oState} onChange={(e) => { setOState(e.target.value); setOLga(""); }} className="w-full px-3 glass-input text-sm">
                    {NIGERIA_STATES_LIST.map((st) => <option key={st} value={st}>{st}</option>)}
                  </select>
                  {oScope === "lga" && (
                    <select value={oLga} onChange={(e) => setOLga(e.target.value)} className="w-full px-3 glass-input text-sm">
                      <option value="">Choose area</option>
                      {(NIGERIA_LGAS[oState] || []).map((l) => <option key={l} value={l}>{l}</option>)}
                    </select>
                  )}
                </div>
              )}

              {oScope === "tier" && (
                <select value={oTier} onChange={(e) => setOTier(e.target.value as AdTier)} className="w-full px-3 glass-input text-sm">
                  <option value="listed">Listed</option>
                  <option value="promoted">Promoted</option>
                  <option value="featured">Featured</option>
                </select>
              )}

              <div>
                <label className="block text-sm font-medium text-dark-200 mb-1.5">What happened</label>
                <input value={oReason} onChange={(e) => setOReason(e.target.value.slice(0, 300))} className="w-full px-3 glass-input text-sm" placeholder="Serve endpoint was down" />
              </div>

              <Button
                size="sm"
                onClick={() => setConfirmOutage(true)}
                disabled={busy || !oStart || !oEnd || !oReason.trim() || (oScope === "lga" && !oLga)}
                leftIcon={<CloudOff className="w-4 h-4" />}
              >
                Credit everyone affected
              </Button>
            </div>

            <h2 className="text-sm font-semibold text-dark-400 uppercase">Reported</h2>
            {outages.length === 0 ? (
              <p className="text-sm text-dark-500">None yet.</p>
            ) : (
              <div className="space-y-2">
                {outages.map((o) => (
                  <div key={o.id} className="glass-card">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm text-dark-100 break-words">{o.reason}</p>
                        <p className="text-xs text-dark-400 mt-0.5">
                          {new Date(o.started_at).toLocaleString()} to {new Date(o.ended_at).toLocaleTimeString()}
                          {o.scope !== "all" && ` · ${o.scope_lga || o.scope_state || o.scope_tier}`}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-sm text-dark-200">{o.placements_credited}</p>
                        <p className="text-[10px] uppercase tracking-wide text-dark-500">credited</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : loading ? (
          <p className="text-sm text-dark-500">Loading...</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-dark-500">Nothing here.</p>
        ) : (
          <div className="space-y-4">
            {rows.map((r) => {
              const a = r.advertisers;
              const spec = tierSpec(r.tier);
              const pop = r.state && r.lga ? catchmentFor(r.state, r.lga) : null;
              return (
                <div key={r.id} className="glass-card space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-dark-100 font-semibold break-words">
                        {a?.business_name || "Unnamed"}
                      </p>
                      <p className="text-xs text-dark-400 mt-0.5">
                        {a?.category} · {spec.name} · {formatNaira(r.price_naira)}/mo
                      </p>
                      <p className="text-xs text-dark-500 mt-0.5">
                        {a?.is_online_only ? "Online only" : r.building_type || "No building type"}
                        {r.lga ? ` · ${r.lga}, ${r.state}` : ""}
                        {pop ? ` · ~${formatCatchment(pop)} in area` : ""}
                      </p>
                    </div>
                    <p className="text-xs text-dark-500 shrink-0">
                      {formatDistanceToNow(new Date(r.created_at), { addSuffix: true })}
                    </p>
                  </div>

                  {a?.tagline && <p className="text-sm text-dark-300 break-words">{a.tagline}</p>}

                  {/* Exactly what a user would see, so review is of the real thing. */}
                  {r.tier === "featured" && (
                    <AdBanner
                      businessName={a?.business_name || ""}
                      text={r.banner_text}
                      gradient={r.banner_gradient}
                      logoUrl={a?.logo_url}
                      compact
                    />
                  )}

                  {a?.logo_url && r.tier !== "featured" && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={a.logo_url} alt="" className="w-16 h-16 rounded-xl object-cover" />
                  )}

                  {/* Openable, because review means actually looking. A
                      link you have to copy out and paste is a link that
                      does not get checked. */}
                  <div className="text-xs text-dark-400 space-y-1">
                    {a?.contact_email && (
                      <p>
                        <a href={`mailto:${a.contact_email}`} className="text-primary-400 hover:text-primary-300 break-all">
                          {a.contact_email}
                        </a>
                      </p>
                    )}
                    {a?.contact_phone && (
                      <p>
                        <a href={`tel:${a.contact_phone.replace(/\s/g, "")}`} className="text-primary-400 hover:text-primary-300">
                          {a.contact_phone}
                        </a>
                      </p>
                    )}
                    {Object.entries(a?.socials || {}).filter(([, v]) => v).map(([k, v]) => {
                      const raw = String(v).trim();
                      const handle = raw.replace(/^@/, "");
                      const href = /^https?:\/\//i.test(raw)
                        ? raw
                        : k === "whatsapp" ? `https://wa.me/${handle.replace(/\D/g, "")}`
                        : k === "instagram" ? `https://instagram.com/${handle}`
                        : k === "facebook" ? `https://facebook.com/${handle}`
                        : k === "tiktok" ? `https://tiktok.com/@${handle}`
                        : k === "youtube" ? `https://youtube.com/@${handle}`
                        : `https://${raw}`;
                      return (
                        <p key={k} className="flex gap-1.5">
                          <span className="text-dark-500 shrink-0">{k}:</span>
                          <a
                            href={href}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-primary-400 hover:text-primary-300 break-all"
                          >
                            {raw}
                          </a>
                        </p>
                      );
                    })}
                  </div>

                  {r.rejection_reason && (
                    <p className="text-xs text-red-400">Rejected: {r.rejection_reason}</p>
                  )}

                  {tab === "pending" && (
                    <>
                      <label className="flex items-start gap-2.5 p-3 rounded-xl bg-amber-500/10 border border-amber-500/25 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => setChecked(e.target.checked)}
                          className="mt-0.5 shrink-0"
                        />
                        <span className="text-xs text-dark-300 leading-relaxed">
                          <span className="font-semibold text-amber-200 flex items-center gap-1.5 mb-1">
                            <AlertTriangle className="w-3.5 h-3.5" /> I have checked this is none of:
                          </span>
                          {PROHIBITED_CATEGORIES.join(" · ")}
                        </span>
                      </label>

                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          onClick={() => act(r.id, "approve")}
                          disabled={busy || !checked}
                          leftIcon={<Check className="w-4 h-4" />}
                        >
                          Approve
                        </Button>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => setRejecting(r)}
                          disabled={busy}
                          leftIcon={<X className="w-4 h-4" />}
                        >
                          Reject
                        </Button>
                      </div>
                    </>
                  )}

                  {tab === "live" && (
                    <Button variant="secondary" size="sm" onClick={() => act(r.id, "pause")} disabled={busy} leftIcon={<Pause className="w-4 h-4" />}>
                      Pause
                    </Button>
                  )}
                  {tab === "paused" && (
                    <Button size="sm" onClick={() => act(r.id, "resume")} disabled={busy} leftIcon={<Play className="w-4 h-4" />}>
                      Put back live
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <Modal isOpen={confirmOutage} onClose={() => setConfirmOutage(false)} title="Credit everyone affected?">
        <div className="space-y-4">
          <p className="text-sm text-dark-300 leading-relaxed">
            Every advert that was live between{" "}
            <span className="text-dark-100">{oStart && new Date(oStart).toLocaleString()}</span> and{" "}
            <span className="text-dark-100">{oEnd && new Date(oEnd).toLocaleString()}</span>
            {oScope !== "all" && <> in <span className="text-dark-100">{oLga || oState || oTier}</span></>}
            {" "}gets those days added to the end of its run, and is notified.
          </p>
          <p className="text-xs text-dark-500">
            This cannot be undone, and an outage is only ever credited once.
          </p>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={() => setConfirmOutage(false)}>Cancel</Button>
            <Button size="sm" onClick={reportOutage} disabled={busy}>
              {busy ? "Crediting..." : "Credit them"}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal isOpen={!!rejecting} onClose={() => setRejecting(null)} title="Reject this advert">
        <div className="space-y-4">
          <p className="text-sm text-dark-400">
            They are told the reason, so write something they can act on.
          </p>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value.slice(0, 300))}
            rows={3}
            placeholder="Why this cannot run"
            className="w-full px-3 glass-input text-sm resize-none"
          />
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={() => setRejecting(null)}>Cancel</Button>
            <Button size="sm" onClick={() => rejecting && act(rejecting.id, "reject", reason)} disabled={busy}>
              Reject
            </Button>
          </div>
        </div>
      </Modal>
    </HudShell>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "green" | "amber" | "red" }) {
  const colour =
    tone === "green" ? "text-green-300"
    : tone === "amber" ? "text-amber-300"
    : tone === "red" ? "text-red-300"
    : "text-dark-100";
  return (
    <div className="p-3 rounded-xl bg-[var(--glass-input-bg)] border border-[var(--glass-border)]">
      <p className="text-[11px] text-dark-500 leading-tight">{label}</p>
      <p className={`text-base font-bold mt-1 ${colour}`}>{value}</p>
    </div>
  );
}
