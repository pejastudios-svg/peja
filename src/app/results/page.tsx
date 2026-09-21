"use client";

// Election Watch: the transparency page.
//
// Any signed-in user can browse: pick an election, drill state -> LGA,
// and see the running totals NEXT TO the photographed result sheets they
// came from, with each sheet's tally history in the open. Upload is for
// VIPs and MVPs, tallying for MVPs, both behind the action PIN. Nothing
// on this page can edit or remove anything: evidence only accumulates.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  BarChart3,
  Camera,
  ChevronLeft,
  ChevronRight,
  EyeOff,
  ImageIcon,
  MapPin,
  Plus,
  UserPlus,
} from "lucide-react";
import { Header } from "@/components/layout/Header";
import { Modal } from "@/components/ui/Modal";
import { PejaSpinner } from "@/components/ui/PejaSpinner";
import { AvatarImage } from "@/components/ui/AvatarImage";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/context/ToastContext";
import { formatDistanceToNow } from "date-fns";
import { NIGERIA_STATES_LIST } from "@/lib/nigeriaLgas";
import {
  addCandidate,
  createElection,
  fetchBrowse,
  fetchElections,
  fetchPinStatus,
  getCachedPin,
  type BrowseData,
  type ElectionSummary,
  type PinStatus,
  type Sheet,
} from "@/lib/elections";
import { ElectionPinGate } from "@/components/elections/ElectionPinGate";
import { ImageLightbox } from "@/components/ui/ImageLightbox";
import { UploadSheetModal } from "@/components/elections/UploadSheetModal";
import { TallySheetModal } from "@/components/elections/TallySheetModal";

type PendingAction =
  | { kind: "upload" }
  | { kind: "tally"; sheet: Sheet }
  | { kind: "create" }
  | { kind: "candidate" };

export default function ResultsPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const toast = useToast();

  const canWrite = !!(user?.is_admin || user?.is_mvp || user?.is_vip);
  const canTally = !!(user?.is_admin || user?.is_mvp);

  const [elections, setElections] = useState<ElectionSummary[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [browse, setBrowse] = useState<BrowseData | null>(null);
  const [scopeState, setScopeState] = useState<string | null>(null);
  const [scopeLga, setScopeLga] = useState<string | null>(null);
  const [loadingBrowse, setLoadingBrowse] = useState(false);
  const [viewerSheet, setViewerSheet] = useState<Sheet | null>(null);
  const [zoomedPhoto, setZoomedPhoto] = useState<string | null>(null);

  // action plumbing
  const [pinStatus, setPinStatus] = useState<PinStatus | null>(null);
  const [pinGateOpen, setPinGateOpen] = useState(false);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [activePin, setActivePin] = useState<string | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [tallySheetTarget, setTallySheetTarget] = useState<Sheet | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [candidateOpen, setCandidateOpen] = useState(false);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      router.replace("/login");
      return;
    }
    // For now the whole feature is tier-gated: VIP, MVP and admin only.
    // When it opens up to every user, delete this block and the matching
    // server checks flip too.
    if (!(user.is_admin || user.is_mvp || user.is_vip)) {
      router.replace("/");
      return;
    }
    fetchElections().then(setElections).catch(() => setElections([]));
    if (canWrite) fetchPinStatus().then(setPinStatus).catch(() => {});
  }, [authLoading, user, canWrite, router]);

  // Every fetch carries a sequence number; only the NEWEST may write
  // state. Without this, opening a state and stepping straight back lets
  // the slower older response land last and paint the previous page's
  // sheets over the new one until the next poll corrects it.
  const fetchSeq = useRef(0);

  const runFetch = useCallback(
    (clearFirst: boolean) => {
      if (!selectedId) return;
      const seq = ++fetchSeq.current;
      if (clearFirst) {
        // A navigation: the old scope's contents must never linger.
        setBrowse(null);
      }
      setLoadingBrowse(true);
      fetchBrowse(selectedId, scopeState, scopeLga)
        .then((d) => {
          if (seq === fetchSeq.current) setBrowse(d);
        })
        .catch(() => {
          if (seq === fetchSeq.current) toast.warning("Could not load results");
        })
        .finally(() => {
          if (seq === fetchSeq.current) setLoadingBrowse(false);
        });
    },
    [selectedId, scopeState, scopeLga, toast],
  );

  // Navigation (election picked, state opened, back to all states):
  // clear instantly, spinner, fresh data. Nothing from the previous
  // view survives the transition.
  useEffect(() => {
    runFetch(true);
  }, [runFetch]);

  // Background refreshes (realtime nudges, the safety poll) swap data
  // in place without blanking what the viewer is reading.
  const reloadBrowse = useCallback(() => runFetch(false), [runFetch]);

  // Keep reloadBrowse reachable from the subscription without making it
  // a dependency: resubscribing on every state/LGA drill would churn
  // websocket channels for no reason.
  const reloadRef = useRef(reloadBrowse);
  reloadRef.current = reloadBrowse;

  // ── live updates ──
  // One channel per OPEN election, listening to inserts and updates on
  // its uploads and tallies. Events never fetch directly: they arm a
  // 2.5s trailing debounce, so an election-night burst of fifty tallies
  // costs viewers ONE aggregate refetch per window, not fifty. A lazy
  // 60s poll rides behind it as the net for dropped websockets.
  useEffect(() => {
    if (!selectedId) return;
    let debounce: ReturnType<typeof setTimeout> | null = null;
    const nudge = () => {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => reloadRef.current(), 2500);
    };

    const channel = supabase
      .channel(`election-live-${selectedId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "election_tallies", filter: `election_id=eq.${selectedId}` },
        nudge,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "election_uploads", filter: `election_id=eq.${selectedId}` },
        nudge,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "election_candidates", filter: `election_id=eq.${selectedId}` },
        nudge,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "elections", filter: `id=eq.${selectedId}` },
        nudge,
      )
      .subscribe();

    const poll = setInterval(() => reloadRef.current(), 60_000);

    return () => {
      if (debounce) clearTimeout(debounce);
      clearInterval(poll);
      supabase.removeChannel(channel);
    };
  }, [selectedId]);

  // The election LIST view is live too: any upload or tally anywhere
  // refreshes the cards (sheet counts, totals), debounced the same way.
  useEffect(() => {
    if (selectedId) return; // detail view has its own scoped channel
    let debounce: ReturnType<typeof setTimeout> | null = null;
    const nudge = () => {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => {
        fetchElections().then(setElections).catch(() => {});
      }, 2500);
    };
    const channel = supabase
      .channel("election-list-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "election_uploads" }, nudge)
      .on("postgres_changes", { event: "*", schema: "public", table: "election_tallies" }, nudge)
      .on("postgres_changes", { event: "*", schema: "public", table: "elections" }, nudge)
      .subscribe();
    const poll = setInterval(() => {
      fetchElections().then(setElections).catch(() => {});
    }, 60_000);
    return () => {
      if (debounce) clearTimeout(debounce);
      clearInterval(poll);
      supabase.removeChannel(channel);
    };
  }, [selectedId]);

  // Route an action through the PIN gate (cached PIN skips it).
  const requestAction = (action: PendingAction) => {
    if (pinStatus?.locked) {
      toast.warning("Your election actions are locked. Contact the admin.");
      return;
    }
    if (pinStatus?.frozen) {
      toast.warning("Election access is frozen on this account.");
      return;
    }
    const cached = getCachedPin();
    if (cached) {
      launchAction(action, cached);
    } else {
      setPending(action);
      setPinGateOpen(true);
    }
  };

  const launchAction = (action: PendingAction, pin: string) => {
    setActivePin(pin);
    if (action.kind === "upload") setUploadOpen(true);
    else if (action.kind === "tally") setTallySheetTarget(action.sheet);
    else if (action.kind === "create") setCreateOpen(true);
    else if (action.kind === "candidate") setCandidateOpen(true);
  };

  const selected = elections?.find((e) => e.id === selectedId) || null;
  const candidateById = useMemo(() => {
    const map = new Map<string, { name: string }>();
    for (const c of browse?.candidates || []) map.set(c.id, c);
    return map;
  }, [browse]);

  const scopeTotal = useMemo(
    () => Object.values(browse?.totals || {}).reduce((a, b) => a + b, 0),
    [browse],
  );

  if (authLoading || !user) return null;

  return (
    <div className="min-h-screen bg-dark-950">
      <Header
        variant="back"
        title="Election Results"
        onBack={() => {
          if (scopeLga) setScopeLga(null);
          else if (scopeState) setScopeState(null);
          else if (selectedId) {
            setSelectedId(null);
            setBrowse(null);
          } else router.back();
        }}
      />
      <main className="pt-app-header-pill px-4 pb-24 max-w-lg mx-auto">
        {/* ── election list ── */}
        {!selectedId && (
          <>
            <p className="text-xs text-dark-500 leading-relaxed mb-4">
              Result sheets photographed at polling units, tallied in the
              open. Every count can be checked against the photo it came
              from. Uploaded evidence can never be edited or deleted.
            </p>
            {elections === null ? (
              <div className="flex justify-center pt-16">
                <PejaSpinner />
              </div>
            ) : elections.length === 0 ? (
              <p className="text-sm text-dark-500 text-center py-16">
                No elections being tracked right now.
              </p>
            ) : (
              <div className="space-y-2.5">
                {elections.map((e) => (
                  <button
                    key={e.id}
                    onClick={() => setSelectedId(e.id)}
                    className="w-full flex items-center gap-3.5 p-4 rounded-2xl bg-dark-800/50 border border-dark-700 text-left active:scale-[0.97] transition-transform"
                  >
                    <div className="w-11 h-11 rounded-xl bg-primary-500/15 overflow-hidden flex items-center justify-center shrink-0">
                      {e.cover_url ? (
                        <AvatarImage src={e.cover_url} wrapperClassName="w-full h-full" />
                      ) : (
                        <BarChart3 className="w-5 h-5 text-primary-400" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[15px] font-semibold text-dark-50 truncate">{e.title}</p>
                      <p className="text-xs text-dark-400">
                        {e.candidates.length} candidate{e.candidates.length === 1 ? "" : "s"}
                        <span className="text-dark-600"> · </span>
                        {e.uploadCount} sheet{e.uploadCount === 1 ? "" : "s"}
                        {e.status === "closed" && (
                          <span className="beacon-wait-text"> · closed</span>
                        )}
                      </p>
                    </div>
                    <ChevronRight className="w-4 h-4 text-dark-500 shrink-0" />
                  </button>
                ))}
              </div>
            )}
            {user?.is_admin && (
              <button
                onClick={() => requestAction({ kind: "create" })}
                className="mt-4 w-full flex items-center justify-center gap-1.5 py-3.5 rounded-2xl border border-dashed border-dark-600 text-sm font-medium text-primary-400 active:scale-[0.97] transition-transform"
              >
                <Plus className="w-4 h-4" /> New election
              </button>
            )}
          </>
        )}

        {/* ── election detail ── */}
        {selectedId && (
          <>
            <div className="mb-4">
              <h1 className="text-lg font-bold text-dark-50">{selected?.title}</h1>
              <p className="text-xs text-dark-400">
                {scopeLga
                  ? `${scopeLga}, ${scopeState}`
                  : scopeState
                    ? scopeState
                    : "All of Nigeria"}
                {scopeTotal > 0 && (
                  <>
                    <span className="text-dark-600"> · </span>
                    {scopeTotal.toLocaleString()} votes tallied
                  </>
                )}
              </p>
            </div>

            {loadingBrowse && !browse ? (
              <div className="flex justify-center pt-16">
                <PejaSpinner />
              </div>
            ) : browse ? (
              <>
                {/* totals: the count next to the evidence */}
                <div className="rounded-2xl bg-dark-800/50 border border-dark-700 p-4 mb-4">
                  <p className="text-xs font-bold uppercase tracking-wider text-dark-500 mb-3">
                    Count in this view
                  </p>
                  {browse.candidates.length === 0 ? (
                    <p className="text-sm text-dark-500">No candidates added yet.</p>
                  ) : (
                    <div className="space-y-3">
                      {[...browse.candidates]
                        .sort((a, b) => (browse.totals[b.id] || 0) - (browse.totals[a.id] || 0))
                        .map((c) => {
                          const votes = browse.totals[c.id] || 0;
                          const pct = scopeTotal > 0 ? (votes / scopeTotal) * 100 : 0;
                          return (
                            <div key={c.id}>
                              <div className="flex items-center gap-2.5 mb-1">
                                <AvatarImage
                                  src={c.photo_url}
                                  wrapperClassName="w-7 h-7 rounded-full bg-primary-600/20 overflow-hidden shrink-0 flex items-center justify-center"
                                  fallback={
                                    <span className="text-[10px] font-bold text-primary-400">
                                      {c.name[0]}
                                    </span>
                                  }
                                />
                                <span className="flex-1 text-sm text-dark-100 truncate">{c.name}</span>
                                <span className="text-sm font-semibold text-dark-100 tabular-nums">
                                  {votes.toLocaleString()}
                                </span>
                              </div>
                              <div className="h-1.5 rounded-full bg-[var(--soft-surface)] overflow-hidden">
                                <div
                                  className="h-full bg-primary-500 rounded-full"
                                  style={{ width: `${pct}%`, transition: "width 400ms var(--ease-out)" }}
                                />
                              </div>
                            </div>
                          );
                        })}
                    </div>
                  )}
                  {user?.is_admin && selected?.status === "active" && (
                    <button
                      onClick={() => requestAction({ kind: "candidate" })}
                      className="mt-3 w-full flex items-center justify-center gap-1.5 py-2 rounded-xl border border-dashed border-dark-600 text-xs font-medium text-primary-400 active:scale-[0.97] transition-transform"
                    >
                      <UserPlus className="w-3.5 h-3.5" /> Add candidate
                    </button>
                  )}
                </div>

                {/* drill-down */}
                {!scopeState && (
                  <div className="mb-4">
                    <p className="text-xs font-bold uppercase tracking-wider text-dark-500 mb-2">
                      By state
                    </p>
                    <div className="grid grid-cols-2 gap-1.5">
                      {NIGERIA_STATES_LIST.map((s) => {
                        const count = Object.values(browse.geoIndex[s] || {}).reduce(
                          (a, b) => a + b,
                          0,
                        );
                        return (
                          <button
                            key={s}
                            onClick={() => setScopeState(s)}
                            className={`flex items-center justify-between px-3 py-2.5 rounded-xl text-sm active:scale-[0.97] transition-transform ${
                              count > 0
                                ? "bg-dark-800/50 border border-dark-700 text-dark-100"
                                : "bg-[var(--soft-surface)] text-dark-500"
                            }`}
                          >
                            <span className="truncate">{s}</span>
                            {count > 0 && (
                              <span className="text-xs text-primary-400 tabular-nums shrink-0 ml-1">
                                {count}
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {scopeState && !scopeLga && (
                  <div className="mb-4">
                    <p className="text-xs font-bold uppercase tracking-wider text-dark-500 mb-2">
                      LGAs in {scopeState}
                    </p>
                    <div className="space-y-1.5">
                      {Object.entries(browse.geoIndex[scopeState] || {})
                        .sort((a, b) => b[1] - a[1])
                        .map(([l, count]) => (
                          <button
                            key={l}
                            onClick={() => setScopeLga(l)}
                            className="w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl bg-dark-800/50 border border-dark-700 text-sm text-dark-100 active:scale-[0.97] transition-transform"
                          >
                            <span>{l}</span>
                            <span className="text-xs text-primary-400 tabular-nums">
                              {count} sheet{count === 1 ? "" : "s"}
                            </span>
                          </button>
                        ))}
                      {Object.keys(browse.geoIndex[scopeState] || {}).length === 0 && (
                        <p className="text-sm text-dark-500 py-3 text-center">
                          No sheets from {scopeState} yet.
                        </p>
                      )}
                    </div>
                  </div>
                )}

                {/* evidence grid */}
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-bold uppercase tracking-wider text-dark-500">
                    Result sheets ({browse.uploads.length})
                  </p>
                </div>
                {browse.uploads.length === 0 ? (
                  <p className="text-sm text-dark-500 text-center py-8">
                    No sheets uploaded in this view yet.
                  </p>
                ) : (
                  <div className="grid grid-cols-3 gap-1.5">
                    {browse.uploads.map((s) => (
                      <button
                        key={s.id}
                        onClick={() => setViewerSheet(s)}
                        className="relative aspect-square rounded-xl overflow-hidden bg-dark-800/60 border border-dark-700 active:scale-[0.97] transition-transform"
                      >
                        {s.hidden ? (
                          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 p-2">
                            <EyeOff className="w-5 h-5 text-dark-500" />
                            <span className="text-[9px] text-dark-500 text-center leading-tight">
                              Hidden: {s.hiddenReason}
                            </span>
                          </div>
                        ) : s.photoUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={s.photoUrl}
                            alt={`Result sheet, ${s.lga}`}
                            className="absolute inset-0 w-full h-full object-cover"
                            loading="lazy"
                          />
                        ) : (
                          <ImageIcon className="absolute inset-0 m-auto w-5 h-5 text-dark-500" />
                        )}
                        <span
                          className={`absolute bottom-1 left-1 right-1 px-1 py-0.5 rounded-md text-[8px] font-semibold truncate ${
                            s.tallies.some((t) => !t.superseded)
                              ? "bg-green-600/90 text-white"
                              : "bg-black/70 text-white/90"
                          }`}
                        >
                          {s.tallies.some((t) => !t.superseded) ? "Tallied" : "Awaiting tally"}
                          {" · "}
                          {s.lga}
                        </span>
                      </button>
                    ))}
                  </div>
                )}

                {canWrite && selected?.status === "active" && (
                  <button
                    onClick={() => requestAction({ kind: "upload" })}
                    className="mt-4 w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl bg-primary-600 text-white text-sm font-semibold active:scale-[0.97] transition-transform"
                  >
                    <Camera className="w-4 h-4" /> Upload result sheet
                  </button>
                )}
              </>
            ) : null}
          </>
        )}
      </main>

      {/* ── sheet viewer: the photo, its place, its arithmetic, its history ── */}
      {viewerSheet && (
        <Modal isOpen onClose={() => setViewerSheet(null)} title="Result sheet">
          <div className="space-y-3">
            {viewerSheet.hidden ? (
              <div className="p-4 rounded-2xl bg-[var(--soft-surface)] border border-[var(--hairline)] text-center">
                <EyeOff className="w-6 h-6 text-dark-500 mx-auto mb-2" />
                <p className="text-sm text-dark-300">
                  This sheet is hidden by moderators: {viewerSheet.hiddenReason}
                </p>
                <p className="text-[11px] text-dark-500 mt-1">
                  The record itself is preserved and cannot be deleted.
                </p>
              </div>
            ) : (
              viewerSheet.photoUrl && (
                <button
                  onClick={() => setZoomedPhoto(viewerSheet.photoUrl)}
                  className="block w-full rounded-2xl overflow-hidden border border-[var(--glass-border)] active:scale-[0.99] transition-transform"
                  aria-label="Expand the photo"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={viewerSheet.photoUrl}
                    alt="Result sheet"
                    className="w-full max-h-[50vh] object-contain bg-black"
                  />
                </button>
              )
            )}

            <div className="flex items-center gap-1.5 text-xs text-dark-400">
              <MapPin className="w-3.5 h-3.5 shrink-0" />
              {viewerSheet.lga}, {viewerSheet.state}
              {viewerSheet.pollingUnit ? `, ${viewerSheet.pollingUnit}` : ""}
            </div>
            <p className="text-[11px] text-dark-500">
              Uploaded{viewerSheet.uploaderName ? ` by ${viewerSheet.uploaderName}` : ""}{" "}
              {formatDistanceToNow(new Date(viewerSheet.createdAt), { addSuffix: true })}
              <br />
              Fingerprint {viewerSheet.sha256.slice(0, 16)}...
            </p>

            {/* tallies, live first, history in the open */}
            {viewerSheet.tallies.length > 0 && (
              <div className="space-y-2">
                {viewerSheet.tallies.map((t) => (
                  <div
                    key={t.id}
                    className={`p-3 rounded-xl border ${
                      t.superseded
                        ? "bg-[var(--soft-surface)] border-[var(--hairline)] opacity-60"
                        : "bg-dark-800/50 border-dark-700"
                    }`}
                  >
                    <p className="text-[11px] text-dark-500 mb-1.5">
                      {t.superseded ? "Superseded tally" : "Current tally"}
                      {t.talliedBy ? ` by ${t.talliedBy}` : ""}{" "}
                      {formatDistanceToNow(new Date(t.createdAt), { addSuffix: true })}
                      {t.note ? ` · "${t.note}"` : ""}
                    </p>
                    <div className="space-y-0.5">
                      {Object.entries(t.figures).map(([cid, votes]) => (
                        <div key={cid} className="flex justify-between text-sm">
                          <span className="text-dark-300">
                            {candidateById.get(cid)?.name || "Candidate"}
                          </span>
                          <span className="text-dark-100 font-medium tabular-nums">
                            {Number(votes).toLocaleString()}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {canTally && !viewerSheet.hidden && selected?.status === "active" && (
              <button
                onClick={() => {
                  const sheet = viewerSheet;
                  setViewerSheet(null);
                  requestAction({ kind: "tally", sheet });
                }}
                className="w-full py-3 rounded-2xl bg-primary-600 text-white text-sm font-semibold active:scale-[0.97] transition-transform"
              >
                {viewerSheet.tallies.some((t) => !t.superseded) ? "Correct the tally" : "Tally this sheet"}
              </button>
            )}
          </div>
        </Modal>
      )}

      {zoomedPhoto && (
        <ImageLightbox isOpen onClose={() => setZoomedPhoto(null)} imageUrl={zoomedPhoto} />
      )}

      {/* ── PIN gate ── */}
      <ElectionPinGate
        isOpen={pinGateOpen}
        pinSet={!!pinStatus?.pinSet}
        onClose={() => {
          setPinGateOpen(false);
          setPending(null);
        }}
        onReady={(pin) => {
          setPinGateOpen(false);
          setPinStatus((prev) => (prev ? { ...prev, pinSet: true } : prev));
          if (pending) launchAction(pending, pin);
          setPending(null);
        }}
      />

      {/* ── action modals ── */}
      {uploadOpen && selectedId && activePin && (
        <UploadSheetModal
          isOpen
          onClose={() => setUploadOpen(false)}
          electionId={selectedId}
          pin={activePin}
          onUploaded={() => reloadBrowse()}
          defaultState={scopeState}
          defaultLga={scopeLga}
        />
      )}
      {tallySheetTarget && selectedId && activePin && browse && (
        <TallySheetModal
          isOpen
          onClose={() => setTallySheetTarget(null)}
          electionId={selectedId}
          sheet={tallySheetTarget}
          candidates={browse.candidates}
          pin={activePin}
          onTallied={() => reloadBrowse()}
        />
      )}
      {createOpen && activePin && (
        <CreateElectionModal
          pin={activePin}
          onClose={() => setCreateOpen(false)}
          onCreated={() => {
            fetchElections().then(setElections).catch(() => {});
          }}
        />
      )}
      {candidateOpen && selectedId && activePin && (
        <AddCandidateModal
          electionId={selectedId}
          pin={activePin}
          onClose={() => setCandidateOpen(false)}
          onAdded={() => reloadBrowse()}
        />
      )}
    </div>
  );
}

// ── small creation modals, kept local: they are thin forms ──

function CreateElectionModal({
  pin,
  onClose,
  onCreated,
}: {
  pin: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const toast = useToast();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      await createElection({ pin, title: title.trim(), description: description.trim() || undefined });
      toast.success("Election created");
      onCreated();
      onClose();
    } catch (e) {
      toast.warning(e instanceof Error ? e.message : "Could not create the election");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title="New election">
      <div className="space-y-3">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={120}
          autoFocus
          placeholder="e.g. Lagos Governorship 2027"
          className="w-full glass-input rounded-xl px-4 text-sm text-dark-100 placeholder:text-dark-500"
        />
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={2000}
          rows={3}
          placeholder="Description (optional)"
          className="w-full glass-input rounded-xl px-4 py-3 text-sm text-dark-100 placeholder:text-dark-500 resize-none"
        />
        <button
          onClick={submit}
          disabled={busy || title.trim().length < 3}
          className="w-full py-3 rounded-2xl bg-primary-600 text-white text-sm font-semibold active:scale-[0.97] transition-transform disabled:opacity-40 flex items-center justify-center gap-2"
        >
          {busy ? <PejaSpinner className="w-4 h-4" /> : null}
          Create election
        </button>
      </div>
    </Modal>
  );
}

function AddCandidateModal({
  electionId,
  pin,
  onClose,
  onAdded,
}: {
  electionId: string;
  pin: string;
  onClose: () => void;
  onAdded: () => void;
}) {
  const toast = useToast();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [photo, setPhoto] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      await addCandidate(electionId, {
        pin,
        name: name.trim(),
        description: description.trim() || undefined,
        photoDataUrl: photo,
      });
      toast.success("Candidate added");
      onAdded();
      onClose();
    } catch (e) {
      toast.warning(e instanceof Error ? e.message : "Could not add the candidate");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title="Add candidate">
      <div className="space-y-3">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={120}
          autoFocus
          placeholder="Candidate name"
          className="w-full glass-input rounded-xl px-4 text-sm text-dark-100 placeholder:text-dark-500"
        />
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={1000}
          rows={2}
          placeholder="Party / description (optional)"
          className="w-full glass-input rounded-xl px-4 py-3 text-sm text-dark-100 placeholder:text-dark-500 resize-none"
        />
        <label className="block">
          <span className="text-xs text-dark-500">Profile photo (optional)</span>
          <input
            type="file"
            accept="image/*"
            className="mt-1 block w-full text-xs text-dark-400 file:mr-3 file:py-2 file:px-3 file:rounded-xl file:border-0 file:bg-[var(--soft-surface-strong)] file:text-dark-200"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              const reader = new FileReader();
              reader.onload = () => setPhoto(String(reader.result));
              reader.readAsDataURL(f);
            }}
          />
        </label>
        <button
          onClick={submit}
          disabled={busy || name.trim().length < 2}
          className="w-full py-3 rounded-2xl bg-primary-600 text-white text-sm font-semibold active:scale-[0.97] transition-transform disabled:opacity-40 flex items-center justify-center gap-2"
        >
          {busy ? <PejaSpinner className="w-4 h-4" /> : null}
          Add candidate
        </button>
      </div>
    </Modal>
  );
}
