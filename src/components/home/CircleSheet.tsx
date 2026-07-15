"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AvatarImage } from "@/components/ui/AvatarImage";
import { SOSButton } from "@/components/sos/SOSButton";
import { SMLButton } from "@/components/safety/SMLButton";
import { useAuth } from "@/context/AuthContext";
import { canUseBeacon } from "@/lib/beacon";
import { Modal } from "@/components/ui/Modal";
import { InvitePanel } from "@/components/community/InvitePanel";
import { QuickAddSheet } from "@/components/community/QuickAddSheet";
import { AddToCircleModal } from "@/components/community/AddToCircleModal";
import { authFetchJson } from "@/lib/authFetch";
import { useToast } from "@/context/ToastContext";
import { CATEGORIES } from "@/lib/types";
import { formatDistanceToNow } from "date-fns";
import { AlertTriangle, ChevronRight, ChevronUp, Plus, Radio, Search as SearchIcon, User, UserPlus, Users, X } from "lucide-react";

export interface CircleMember {
  id: string;
  name: string;
  avatar: string | null;
  lat: number | null;
  lng: number | null;
  freshLabel: string | null;
  tier: "fresh" | "stale" | "cold";
  sosActive: boolean;
  smlActive: boolean;
  smlOverdue: boolean;
  batteryPct: number | null;
  speedKmh?: number | null;
  stillSince?: string | null;
}

export interface NearbyIncident {
  id: string;
  category: string;
  lat: number;
  lng: number;
  createdAt: string;
  address: string | null;
}

// Sheet geometry: fixed height, translated down to its peek. Snap points
// only (peek/expanded) - simple, predictable, and cheap to render.
const PEEK_PX = 96;
const NAV_CLEARANCE = 62; // flush against the banner nav (62px tall)

/**
 * The swipe-up sheet (PEJA_MAP_HOME_DESIGN.md §2). Drag follows the
 * finger 1:1; release snaps to the nearest state with a spring. Tap on
 * the peek toggles. Transitions disable during drag so it never fights
 * the finger - that's what makes it feel native.
 */
export function CircleSheet({
  members,
  circles = [],
  incidents,
  onMemberTap,
  onIncidentTap,
  onExpandedChange,
  onSheetMove,
}: {
  members: CircleMember[];
  circles?: { id: string; name: string; members: CircleMember[]; owned: boolean }[];
  incidents: NearbyIncident[];
  onMemberTap: (m: CircleMember) => void;
  onIncidentTap: (i: NearbyIncident) => void;
  onExpandedChange?: (expanded: boolean) => void;
  onSheetMove?: (topFromBottom: number | null, dragging: boolean) => void;
}) {
  const router = useRouter();
  const { user } = useAuth();
  const [expanded, setExpanded] = useState(true); // default open (product decision)
  const [inviteOpen, setInviteOpen] = useState(false);
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  // Progressive reveal (professional-app style): 4 -> +10 per tap ->
  // "Show less" resets. Same pattern inside expanded circles.
  const [visibleCount, setVisibleCount] = useState(4);
  const [circleVisible, setCircleVisible] = useState<Record<string, number>>({});
  // Animated search across people, circles, and people inside circles.
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [openCircle, setOpenCircle] = useState<string | null>(null);
  const [addToCircle, setAddToCircle] = useState<{ id: string; name: string; memberIds: string[]; owned: boolean } | null>(null);
  const toast = useToast();
  // Create a circle right from the map sheet, then flow into inviting.
  const [createOpen, setCreateOpen] = useState(false);
  const [newCircleName, setNewCircleName] = useState("");
  const [creating, setCreating] = useState(false);
  const createCircle = async () => {
    const name = newCircleName.trim();
    if (!name || creating) return;
    setCreating(true);
    try {
      const { res, data } = await authFetchJson("/api/community/groups", {
        method: "POST",
        body: JSON.stringify({ action: "create", name }),
      });
      if (!res.ok || !data?.group?.id) {
        toast.warning(data?.error || "Couldn't create the circle");
        return;
      }
      setCreateOpen(false);
      setNewCircleName("");
      // Straight into inviting people to the new circle.
      setAddToCircle({ id: data.group.id, name, memberIds: [], owned: true });
    } finally {
      setCreating(false);
    }
  };
  const [dragY, setDragY] = useState<number | null>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ startY: number; startT: number; baseOffset: number } | null>(null);
  const moved = useRef(false);

  const collapsedOffset = useCallback(
    () => (sheetRef.current?.offsetHeight ?? 400) - PEEK_PX,
    []
  );

  // Pointer Events: mouse on desktop and touch on phone share one path,
  // so a PC test proves the phone behavior.
  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    moved.current = false;
    drag.current = {
      startY: e.clientY,
      startT: Date.now(),
      baseOffset: expanded ? 0 : collapsedOffset(),
    };
    // Capture deferred to first movement so taps still reach child
    // buttons (+ chip) - capture-on-down steals their click.
  }, [expanded, collapsedOffset]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!drag.current) return;
    const delta = e.clientY - drag.current.startY;
    if (!moved.current && Math.abs(delta) > 8) {
      moved.current = true;
      (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    }
    const next = Math.min(collapsedOffset(), Math.max(0, drag.current.baseOffset + delta));
    setDragY(next);
    // Live position so map controls ride the finger (measured from the
    // element, so env-insets are already accounted for).
    if (sheetRef.current) {
      const rect = sheetRef.current.getBoundingClientRect();
      onSheetMove?.(window.innerHeight - rect.top, true);
    }
  }, [collapsedOffset]);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    if (!drag.current) return;
    const delta = e.clientY - drag.current.startY;
    const elapsed = Math.max(1, Date.now() - drag.current.startT);
    const velocity = delta / elapsed; // px/ms, + = downward
    drag.current = null;
    setDragY(null);
    onSheetMove?.(null, false);
    // A stationary tap is onClick's job (toggle); only real drags snap.
    if (!moved.current) return;
    // Fast flick wins; otherwise snap past the halfway point.
    if (velocity < -0.35) setExpanded(true);
    else if (velocity > 0.35) setExpanded(false);
    else if (dragY != null) setExpanded(dragY < collapsedOffset() / 2);
  }, [dragY, collapsedOffset]);

  const onPointerCancel = useCallback(() => {
    drag.current = null;
    setDragY(null);
  }, []);

  useEffect(() => {
    onExpandedChange?.(expanded);
  }, [expanded, onExpandedChange]);

  // Collapse when the keyboard would fight the sheet (member search later).
  useEffect(() => {
    const onResize = () => setExpanded((v) => v);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const offset = dragY ?? (expanded ? 0 : undefined);
  const sosCount = members.filter((m) => m.sosActive).length;
  const overdueCount = members.filter((m) => m.smlOverdue && !m.sosActive).length;
  const urgent = sosCount > 0 || overdueCount > 0;
  const statusLine =
    sosCount > 0
      ? `${sosCount} SOS active in your circle`
      : overdueCount > 0
        ? `${overdueCount} check-in${overdueCount === 1 ? "" : "s"} overdue`
      : members.length === 0
        ? "Just you so far"
        : incidents.length > 0
          ? `${members.length} ${members.length === 1 ? "person" : "people"} · ${incidents.length} incident${incidents.length === 1 ? "" : "s"} nearby`
          : `All quiet · ${members.length} ${members.length === 1 ? "person" : "people"}`;

  const categoryName = (cid: string) => CATEGORIES.find((c) => c.id === cid)?.name || "Incident";


  const memberRow = (m: CircleMember) => (
    <button
      key={m.id}
      onClick={() => { onMemberTap(m); setExpanded(false); }}
      className="w-full flex items-center gap-3 p-2.5 rounded-2xl bg-dark-800/50 border border-dark-700/60 active:scale-[0.985] transition-transform"
    >
      <div
        className={`w-10 h-10 rounded-full overflow-hidden border-2 bg-dark-700 flex items-center justify-center shrink-0 ${
          m.sosActive || m.smlOverdue ? "border-red-500" : m.tier === "fresh" ? "border-green-500/70" : "border-dark-600"
        }`}
      >
        {m.avatar ? (
          <AvatarImage src={m.avatar} wrapperClassName="w-full h-full" />
        ) : (
          <User className="w-5 h-5 text-dark-300" />
        )}
      </div>
      <div className="flex-1 text-left min-w-0">
        <p className="text-sm font-medium text-dark-100 truncate">{m.name}</p>
        <p className={`text-xs ${m.sosActive || m.smlOverdue ? "beacon-bad-text font-semibold" : "text-dark-500"}`}>
          {m.sosActive
            ? "SOS ACTIVE - tap to view"
            : m.smlOverdue
              ? "Check-in overdue - contacts alerted"
              : m.smlActive
                ? "Sharing live with you"
                : m.freshLabel
                ? m.tier === "fresh"
                  ? `Updated ${m.freshLabel === "now" ? "just now" : `${m.freshLabel} ago`}`
                  : `Last seen ${m.freshLabel} ago`
                : "No location yet"}
        </p>
      </div>
      {m.batteryPct != null && (
        <span className={`text-xs shrink-0 ${m.batteryPct <= 15 ? "beacon-bad-text" : "text-dark-500"}`}>
          {m.batteryPct}%
        </span>
      )}
    </button>
  );

  return (
    <>
      <div
        ref={sheetRef}
        className="fixed left-0 right-0 z-40 rounded-t-[24px] overflow-hidden"
        style={{
          bottom: `calc(env(safe-area-inset-bottom, 0px) + ${NAV_CLEARANCE}px)`,
          height: "min(62vh, 520px)",
          background: "var(--glass-float-bg)",
          borderTop: "1px solid var(--glass-border)",
          boxShadow: "var(--glass-shadow-float)",
          transform:
            offset != null
              ? `translateY(${offset}px)`
              : `translateY(calc(100% - ${PEEK_PX}px))`,
          transition: dragY != null ? "none" : "transform 0.45s cubic-bezier(0.32, 0.72, 0, 1)",
        }}
      >
        {/* ── peek ──
            div-as-button (role + keyboard) because it CONTAINS the invite
            button, and HTML forbids nesting real <button> elements. */}
        <div
          role="button"
          tabIndex={0}
          className="w-full text-left px-4 pt-2 pb-1 cursor-grab select-none"
          style={{ touchAction: "none" }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerCancel}
          onClick={() => {
            if (moved.current) {
              moved.current = false;
              return;
            }
            setExpanded((v) => !v);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              setExpanded((v) => !v);
            }
          }}
        >
          <div className="mx-auto w-10 h-1 rounded-full sheet-handle mb-2" />
          <div className="flex items-center gap-2">
            <span
              className={`w-2 h-2 rounded-full shrink-0 ${
                urgent ? "bg-red-500 animate-pulse" : "bg-green-500 beacon-live-dot"
              }`}
            />
            <p className="flex-1 text-sm font-semibold text-dark-100 truncate">{statusLine}</p>
            <ChevronUp
              className="w-4 h-4 text-dark-400 transition-transform duration-300"
              style={{ transform: expanded ? "rotate(180deg)" : "none" }}
            />
          </div>
          <div className="flex items-center gap-1.5 mt-2">
            {members.slice(0, 5).map((m) => (
              <div
                key={m.id}
                className={`w-8 h-8 rounded-full overflow-hidden border-2 bg-dark-700 flex items-center justify-center ${
                  m.sosActive || m.smlOverdue ? "border-red-500" : m.tier === "fresh" ? "border-green-500/70" : "border-dark-600"
                }`}
              >
                {m.avatar ? (
                  <AvatarImage src={m.avatar} wrapperClassName="w-full h-full" />
                ) : (
                  <User className="w-4 h-4 text-dark-300" />
                )}
              </div>
            ))}
            <button
              onClick={(e) => { e.stopPropagation(); setQuickAddOpen(true); }}
              className="w-8 h-8 rounded-full border-2 border-dashed border-primary-500/60 flex items-center justify-center active:scale-90 transition-transform"
              aria-label="Add to community"
            >
              <Plus className="beacon-accent-text w-4 h-4" />
            </button>
          </div>
        </div>

        {/* ── expanded content ── */}
        <div className="px-4 pb-6 pt-2 h-full overflow-y-auto overscroll-contain">
          {/* Quick actions: a second front door to the safety features
              (the center fan stays). SOS/SML mount the real components -
              they carry their own flows and modals. */}
          <div className={`grid gap-2 mb-4 mt-1 ${canUseBeacon(user?.email) ? "grid-cols-4" : "grid-cols-3"}`}>
            <div className="flex flex-col items-center gap-1.5">
              <div className="w-13 h-13 flex items-center justify-center" style={{ width: 52, height: 52 }}>
                <SOSButton className="w-full h-full" />
              </div>
              <span className="text-[10px] font-bold uppercase tracking-wide text-dark-400">SOS</span>
            </div>
            <div className="flex flex-col items-center gap-1.5">
              <div style={{ width: 52, height: 52 }} className="flex items-center justify-center">
                <SMLButton />
              </div>
              <span className="text-[10px] font-bold uppercase tracking-wide text-dark-400">Check in</span>
            </div>
            {canUseBeacon(user?.email) && (
              <div className="flex flex-col items-center gap-1.5">
                <button
                  onClick={() => router.push("/beacon")}
                  aria-label="Beacon"
                  style={{ width: 52, height: 52 }}
                  className="rounded-full bg-dark-800 border border-primary-500/40 shadow-lg flex items-center justify-center active:scale-90 transition-transform"
                >
                  <Radio className="beacon-accent-text w-5 h-5" />
                </button>
                <span className="text-[10px] font-bold uppercase tracking-wide text-dark-400">Beacon</span>
              </div>
            )}
            <div className="flex flex-col items-center gap-1.5">
              <button
                onClick={() => setQuickAddOpen(true)}
                aria-label="Add people"
                style={{ width: 52, height: 52 }}
                className="rounded-full bg-primary-600 shadow-lg shadow-primary-900/40 flex items-center justify-center active:scale-90 transition-transform"
              >
                <UserPlus className="w-5 h-5 text-white" />
              </button>
              <span className="text-[10px] font-bold uppercase tracking-wide text-dark-400">Add people</span>
            </div>
          </div>

          <div className="flex items-center justify-between mb-2 mt-1 gap-2">
            <p className="text-xs font-bold uppercase tracking-wider text-dark-500 shrink-0">
              Your people
            </p>
            <div className="flex items-center gap-1 min-w-0">
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search people or circles"
                className="rounded-full bg-dark-800/70 border border-dark-700 text-xs text-dark-100 placeholder:text-dark-500 focus:outline-none focus:border-primary-500"
                style={{
                  width: searchOpen ? 170 : 0,
                  opacity: searchOpen ? 1 : 0,
                  paddingLeft: searchOpen ? 12 : 0,
                  paddingRight: searchOpen ? 12 : 0,
                  paddingTop: 6,
                  paddingBottom: 6,
                  transition: "width 0.3s cubic-bezier(0.32, 0.72, 0, 1), opacity 0.2s, padding 0.3s",
                }}
              />
              <button
                onClick={() => {
                  setSearchOpen((v) => {
                    if (v) setQuery("");
                    return !v;
                  });
                }}
                aria-label="Search"
                className="w-7 h-7 rounded-full flex items-center justify-center bg-dark-800/70 border border-dark-700 active:scale-90 transition-transform shrink-0"
              >
                {searchOpen ? (
                  <X className="w-3.5 h-3.5 text-dark-400" />
                ) : (
                  <SearchIcon className="w-3.5 h-3.5 text-dark-400" />
                )}
              </button>
            </div>
          </div>
          {members.length === 0 ? (
            <button
              onClick={() => setInviteOpen(true)}
              className="w-full rounded-2xl border border-dashed border-primary-500/40 p-4 text-center active:scale-[0.98] transition-transform"
            >
              <p className="text-sm text-dark-300 font-medium">No one here yet</p>
              <p className="text-xs text-dark-500 mt-0.5">Invite the people who should know you&apos;re safe</p>
            </button>
          ) : (
            <div className="space-y-1.5">
              {(() => {
                const q = query.trim().toLowerCase();
                const list = q ? members.filter((m) => m.name.toLowerCase().includes(q)) : members;
                const shown = q ? list : list.slice(0, visibleCount);
                const remaining = list.length - shown.length;
                return (
                  <>
                    {shown.map((m) => memberRow(m))}
                    {q && list.length === 0 && (
                      <p className="text-xs text-dark-500 text-center py-2">No one matches</p>
                    )}
                    {!q && remaining > 0 && (
                      <button
                        onClick={() => setVisibleCount((c) => c + 10)}
                        className="w-full flex items-center justify-center gap-1 py-2.5 rounded-2xl text-sm font-semibold beacon-accent-text active:scale-[0.98] transition-transform"
                      >
                        See more ({remaining})
                        <ChevronRight className="w-4 h-4 rotate-90" />
                      </button>
                    )}
                    {!q && remaining <= 0 && list.length > 4 && (
                      <button
                        onClick={() => setVisibleCount(4)}
                        className="w-full flex items-center justify-center gap-1 py-2.5 rounded-2xl text-sm font-semibold beacon-accent-text active:scale-[0.98] transition-transform"
                      >
                        Show less
                        <ChevronRight className="w-4 h-4 -rotate-90" />
                      </button>
                    )}
                  </>
                );
              })()}
            </div>
          )}

          {/* my circles, expandable in place - every member pingable */}
          {(
            <>
              <p className="text-xs font-bold uppercase tracking-wider text-dark-500 mb-2 mt-5">
                Your circles
              </p>
              <button
                onClick={() => setCreateOpen(true)}
                className="w-full flex items-center gap-3 p-2.5 mb-1.5 rounded-2xl border border-dashed border-primary-500/50 active:scale-[0.985] transition-transform"
              >
                <div className="w-9 h-9 rounded-full border border-dashed border-primary-500/60 flex items-center justify-center shrink-0">
                  <Plus className="beacon-accent-text w-4 h-4" />
                </div>
                <p className="flex-1 text-left text-sm font-medium text-dark-300">New circle</p>
              </button>
              <div className="space-y-1.5">
                {(() => {
                  const q = query.trim().toLowerCase();
                  const list = q
                    ? circles.filter(
                        (c) =>
                          c.name.toLowerCase().includes(q) ||
                          c.members.some((m) => m.name.toLowerCase().includes(q))
                      )
                    : circles;
                  if (q && list.length === 0) {
                    return <p className="text-xs text-dark-500 text-center py-2">No circles match</p>;
                  }
                  return list.map((c) => (
                  <div key={c.id}>
                    <button
                      onClick={() => setOpenCircle((v) => (v === c.id ? null : c.id))}
                      className="w-full flex items-center gap-3 p-2.5 rounded-2xl bg-dark-800/50 border border-dark-700/60 active:scale-[0.985] transition-transform"
                    >
                      <div className="w-9 h-9 rounded-full bg-primary-500/15 flex items-center justify-center shrink-0">
                        <Users className="beacon-accent-text w-4.5 h-4.5" />
                      </div>
                      <p className="flex-1 text-left text-sm font-medium text-dark-100 truncate">
                        {c.name} · {c.members.length}
                      </p>
                      <ChevronRight
                        className="w-4 h-4 text-dark-500 transition-transform duration-300 shrink-0"
                        style={{ transform: openCircle === c.id ? "rotate(90deg)" : "none" }}
                      />
                    </button>
                    {(openCircle === c.id || query.trim() !== "") && (
                      <div className="space-y-1.5 mt-1.5 ml-3 pl-3 border-l border-dark-700/60">
                        {(() => {
                          const q = query.trim().toLowerCase();
                          const nameHit = q && c.name.toLowerCase().includes(q);
                          const all = q && !nameHit
                            ? c.members.filter((m) => m.name.toLowerCase().includes(q))
                            : c.members;
                          const cap = circleVisible[c.id] ?? 6;
                          const shown = q ? all : all.slice(0, cap);
                          const remaining = all.length - shown.length;
                          return (
                            <>
                              {shown.map((m) => memberRow(m))}
                              {!q && remaining > 0 && (
                                <button
                                  onClick={() =>
                                    setCircleVisible((prev) => ({ ...prev, [c.id]: cap + 10 }))
                                  }
                                  className="w-full flex items-center justify-center gap-1 py-2 rounded-2xl text-xs font-semibold beacon-accent-text active:scale-[0.98] transition-transform"
                                >
                                  See more ({remaining})
                                  <ChevronRight className="w-3.5 h-3.5 rotate-90" />
                                </button>
                              )}
                            </>
                          );
                        })()}
                        {c.owned && (
                          <button
                            onClick={() =>
                              setAddToCircle({
                                id: c.id,
                                name: c.name,
                                memberIds: c.members.map((m) => m.id),
                                owned: true,
                              })
                            }
                            className="w-full flex items-center justify-center gap-1.5 py-2 rounded-2xl border border-dashed border-primary-500/40 text-xs font-semibold beacon-accent-text active:scale-95 transition-transform"
                          >
                            <Plus className="w-3.5 h-3.5" /> Add people
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                  ));
                })()}
              </div>
            </>
          )}

          <p className="text-xs font-bold uppercase tracking-wider text-dark-500 mb-2 mt-5">
            Near you
          </p>
          {incidents.length === 0 ? (
            <p className="text-sm text-dark-500 py-2">Nothing reported near you today.</p>
          ) : (
            <div className="space-y-1.5">
              {incidents.map((i) => (
                <button
                  key={i.id}
                  onClick={() => onIncidentTap(i)}
                  className="w-full flex items-center gap-3 p-2.5 rounded-2xl bg-dark-800/50 border border-dark-700/60 active:scale-[0.985] transition-transform"
                >
                  <div className="w-9 h-9 rounded-full bg-amber-500/15 flex items-center justify-center shrink-0">
                    <AlertTriangle className="beacon-wait-text w-4 h-4" />
                  </div>
                  <div className="flex-1 text-left min-w-0">
                    <p className="text-sm font-medium text-dark-100 truncate">{categoryName(i.category)}</p>
                    <p className="text-xs text-dark-500 truncate">
                      {formatDistanceToNow(new Date(i.createdAt), { addSuffix: true })}
                      {i.address ? ` · ${i.address}` : ""}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          )}
          {/* spacer so the last row clears the peek-height crop */}
          <div style={{ height: PEEK_PX }} />
        </div>
      </div>

      <Modal isOpen={inviteOpen} onClose={() => setInviteOpen(false)} title="Invite your people">
        <InvitePanel />
      </Modal>
      <Modal isOpen={createOpen} onClose={() => { setCreateOpen(false); setNewCircleName(""); }} title="New circle">
        <div className="space-y-4">
          <p className="text-sm text-dark-400">
            Name your circle, then pick the people who belong in it.
          </p>
          <input
            type="text"
            value={newCircleName}
            onChange={(e) => setNewCircleName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") createCircle(); }}
            placeholder="Family, Roommates, Ride group..."
            maxLength={40}
            autoFocus
            className="w-full px-4 py-3 rounded-2xl bg-dark-800/70 border border-dark-700 text-sm text-dark-100 placeholder:text-dark-500 focus:outline-none focus:border-primary-500"
          />
          <button
            onClick={createCircle}
            disabled={!newCircleName.trim() || creating}
            className="w-full py-3 rounded-2xl bg-primary-600 text-white text-sm font-semibold active:scale-[0.98] transition-transform disabled:opacity-60"
          >
            {creating ? "Creating..." : "Create and add people"}
          </button>
        </div>
      </Modal>
      <QuickAddSheet open={quickAddOpen} onClose={() => setQuickAddOpen(false)} />
      <AddToCircleModal
        groupId={addToCircle?.id ?? null}
        groupName={addToCircle?.name ?? ""}
        existingMemberIds={addToCircle?.memberIds ?? []}
        onClose={() => setAddToCircle(null)}
      />
    </>
  );
}
