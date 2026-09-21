"use client";

// Admin: Election Watch management.
//
// Every button is OPTIMISTIC: the UI flips the moment it is pressed, the
// request runs behind it, and a failure flips the state back with the
// error on screen. No reloads, no waiting.
//
// Moderation (hide/unhide, freeze, unlock, close/reopen) runs on the
// admin session. The danger zone at the bottom deletes records, and every
// delete demands the admin dashboard PIN again, fresh, per action: the
// session cookie alone cannot destroy history.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  EyeOff,
  Eye,
  Lock,
  LockOpen,
  MapPin,
  RotateCcw,
  ShieldOff,
  ShieldCheck,
  Trash2,
  TriangleAlert,
  Pencil,
  XCircle,
  Check,
  Download,
  FileSpreadsheet,
} from "lucide-react";
import { authFetchJson } from "@/lib/authFetch";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/context/ToastContext";
import { PejaSpinner } from "@/components/ui/PejaSpinner";
import { Modal } from "@/components/ui/Modal";
import { ImageLightbox } from "@/components/ui/ImageLightbox";

interface AdminUpload {
  id: string;
  election_id: string;
  state: string;
  lga: string;
  polling_unit: string | null;
  photo_url: string;
  photo_sha256: string;
  device_lat: number | null;
  device_lng: number | null;
  hidden: boolean;
  hidden_reason: string | null;
  tallies_hidden: boolean;
  created_at: string;
  users?: { full_name?: string };
}

interface AdminAccess {
  user_id: string;
  failed_attempts: number;
  locked_at: string | null;
  frozen: boolean;
  users?: { full_name?: string; is_vip?: boolean; is_mvp?: boolean };
}

interface AdminElection {
  id: string;
  title: string;
  status: string;
  created_at: string;
  users?: { full_name?: string };
}

interface AdminTally {
  id: string;
  upload_id: string;
  figures: Record<string, number>;
  note: string | null;
  superseded_by: string | null;
  device_lat: number | null;
  device_lng: number | null;
  created_at: string;
  users?: { full_name?: string };
}

interface AdminCandidate {
  id: string;
  election_id: string;
  name: string;
  description: string | null;
  photo_url: string | null;
  sort: number;
}

interface AuditRow {
  id: string;
  action: string;
  subject: Record<string, unknown>;
  created_at: string;
  users?: { full_name?: string };
}

// What the danger-zone confirm modal is about to do.
type DangerTarget =
  | { kind: "delete_upload"; upload: AdminUpload }
  | { kind: "delete_election"; election: AdminElection }
  | { kind: "delete_access"; access: AdminAccess }
  | { kind: "clear_audit" }
  | { kind: "purge_all" };

export default function AdminElectionsPage() {
  const toast = useToast();
  const [elections, setElections] = useState<AdminElection[]>([]);
  const [uploads, setUploads] = useState<AdminUpload[]>([]);
  const [access, setAccess] = useState<AdminAccess[]>([]);
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [talliedIds, setTalliedIds] = useState<Set<string>>(new Set());
  const [candidates, setCandidates] = useState<AdminCandidate[]>([]);
  const [tallies, setTallies] = useState<AdminTally[]>([]);
  const [detailUpload, setDetailUpload] = useState<AdminUpload | null>(null);
  // Export state: selection set + progress while zipping.
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [exporting, setExporting] = useState<string | null>(null);
  const [editCandidate, setEditCandidate] = useState<AdminCandidate | null>(null);
  const [loaded, setLoaded] = useState(false);

  const [hideTarget, setHideTarget] = useState<AdminUpload | null>(null);
  const [hideReason, setHideReason] = useState("");
  const [hideTally, setHideTally] = useState(true);
  const [zoomedPhoto, setZoomedPhoto] = useState<string | null>(null);
  const [danger, setDanger] = useState<DangerTarget | null>(null);
  const [dangerPin, setDangerPin] = useState("");
  const [dangerBusy, setDangerBusy] = useState(false);

  const load = useCallback(async () => {
    const { res, data } = await authFetchJson("/api/admin/elections");
    if (res.ok && data?.ok) {
      setElections(data.elections);
      setUploads(data.uploads);
      setAccess(data.access);
      setAudit(data.audit);
      setTallies(data.tallies || []);
      setTalliedIds(
        new Set(
          (data.tallies || [])
            .filter((t: { superseded_by: string | null }) => !t.superseded_by)
            .map((t: { upload_id: string }) => t.upload_id),
        ),
      );
      setCandidates(data.candidates || []);
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // ── live: any change to any Election Watch table re-pulls the admin
  // snapshot, debounced so a burst is one refetch. Requires the admin
  // read policies from 20260815_election_admin_realtime (realtime
  // respects RLS with the SUBSCRIBER'S identity, and access/audit are
  // otherwise service-role only, so their events would never arrive).
  // Optimistic flips converge to server truth when the reload lands.
  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => {
    let debounce: ReturnType<typeof setTimeout> | null = null;
    const nudge = () => {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => loadRef.current(), 1500);
    };
    const channel = supabase.channel("admin-election-watch");
    for (const table of [
      "elections",
      "election_candidates",
      "election_uploads",
      "election_tallies",
      "election_access",
      "election_audit",
    ]) {
      channel.on("postgres_changes", { event: "*", schema: "public", table }, nudge);
    }
    channel.subscribe();
    return () => {
      if (debounce) clearTimeout(debounce);
      supabase.removeChannel(channel);
    };
  }, []);

  // Optimistic runner: apply() flips the UI now; a failed request calls
  // rollback() and shows the error. Success just leaves the flip standing.
  const run = async (
    payload: Record<string, unknown>,
    apply: () => void,
    rollback: () => void,
  ) => {
    apply();
    try {
      const { res, data } = await authFetchJson("/api/admin/elections", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      if (!res.ok || !data?.ok) throw new Error(data?.error || "Action failed");
    } catch (e) {
      rollback();
      toast.warning(e instanceof Error ? e.message : "Action failed");
    }
  };

  // ── optimistic moderation actions ──

  const setUploadHidden = (id: string, hidden: boolean, reason: string | null, tHidden: boolean) =>
    setUploads((prev) =>
      prev.map((u) =>
        u.id === id
          ? { ...u, hidden, hidden_reason: reason, tallies_hidden: tHidden }
          : u,
      ),
    );

  const hideUpload = (u: AdminUpload, reason: string, alsoTally: boolean) =>
    run(
      { action: "hide_upload", uploadId: u.id, reason, hideTally: alsoTally },
      () => setUploadHidden(u.id, true, reason, alsoTally),
      () => setUploadHidden(u.id, u.hidden, u.hidden_reason, u.tallies_hidden),
    );

  const unhideUpload = (u: AdminUpload) =>
    run(
      { action: "unhide_upload", uploadId: u.id },
      () => setUploadHidden(u.id, false, null, true),
      () => setUploadHidden(u.id, u.hidden, u.hidden_reason, u.tallies_hidden),
    );

  const setFrozen = (userId: string, frozen: boolean) =>
    setAccess((prev) => prev.map((a) => (a.user_id === userId ? { ...a, frozen } : a)));

  const toggleFreeze = (a: AdminAccess) =>
    run(
      { action: a.frozen ? "unfreeze_user" : "freeze_user", userId: a.user_id },
      () => setFrozen(a.user_id, !a.frozen),
      () => setFrozen(a.user_id, a.frozen),
    );

  const unlockPin = (a: AdminAccess) =>
    run(
      { action: "unlock_pin", userId: a.user_id },
      () =>
        setAccess((prev) =>
          prev.map((x) =>
            x.user_id === a.user_id ? { ...x, locked_at: null, failed_attempts: 0 } : x,
          ),
        ),
      () =>
        setAccess((prev) =>
          prev.map((x) =>
            x.user_id === a.user_id
              ? { ...x, locked_at: a.locked_at, failed_attempts: a.failed_attempts }
              : x,
          ),
        ),
    );

  const resetPin = (a: AdminAccess) =>
    run(
      { action: "reset_pin", userId: a.user_id },
      () => setAccess((prev) => prev.filter((x) => x.user_id !== a.user_id)),
      () => setAccess((prev) => [...prev, a]),
    );

  const setElectionStatus = (id: string, status: string) =>
    setElections((prev) => prev.map((e) => (e.id === id ? { ...e, status } : e)));

  const toggleElection = (e: AdminElection) => {
    const closing = e.status === "active";
    run(
      { action: closing ? "close_election" : "reopen_election", electionId: e.id },
      () => setElectionStatus(e.id, closing ? "closed" : "active"),
      () => setElectionStatus(e.id, e.status),
    );
  };

  // ── evidence export ──
  // The court bundle: photos named by record id, plus fingerprints.csv
  // carrying the full ledger (who, when, where claimed, where the phone
  // was, SHA-256, tally status). An independent expert can verify any
  // photo with: shasum -a 256 <file> and compare against the CSV.

  const electionTitle = (id: string) =>
    elections.find((e) => e.id === id)?.title || "election";

  const fingerprintCsv = (rows: AdminUpload[]) => {
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const header = [
      "record_id", "election", "state", "lga", "polling_unit", "uploaded_by",
      "uploaded_at_utc", "sha256", "device_lat", "device_lng", "hidden",
      "hidden_reason", "tally_status", "photo_url",
    ].join(",");
    const lines = rows.map((u) =>
      [
        u.id, electionTitle(u.election_id), u.state, u.lga, u.polling_unit || "",
        u.users?.full_name || "", new Date(u.created_at).toISOString(), u.photo_sha256,
        u.device_lat ?? "", u.device_lng ?? "", u.hidden ? "yes" : "no",
        u.hidden_reason || "", talliedIds.has(u.id) ? "tallied" : "awaiting tally",
        u.photo_url,
      ].map(esc).join(","),
    );
    return [header, ...lines].join("\n");
  };

  const saveBlob = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportCsv = (rows: AdminUpload[]) => {
    saveBlob(
      new Blob([fingerprintCsv(rows)], { type: "text/csv" }),
      `election-fingerprints-${new Date().toISOString().slice(0, 10)}.csv`,
    );
    toast.success("Fingerprint ledger exported");
  };

  const exportZip = async (rows: AdminUpload[]) => {
    if (rows.length === 0) return;
    setExporting("0");
    try {
      const { default: JSZip } = await import("jszip");
      const zip = new JSZip();
      zip.file("fingerprints.csv", fingerprintCsv(rows));
      let done = 0;
      for (const u of rows) {
        try {
          const res = await fetch(u.photo_url);
          const blob = await res.blob();
          const ext = (u.photo_url.split(".").pop() || "jpg").split("?")[0];
          zip.file(
            `${u.state}/${u.lga}/${u.id}.${ext}`,
            blob,
          );
        } catch {
          zip.file(`${u.state}/${u.lga}/${u.id}.MISSING.txt`,
            `Could not fetch ${u.photo_url} during export. The record and its SHA-256 remain in fingerprints.csv.`);
        }
        done++;
        setExporting(`${done}/${rows.length}`);
      }
      const out = await zip.generateAsync({ type: "blob" });
      saveBlob(out, `election-evidence-${new Date().toISOString().slice(0, 10)}.zip`);
      toast.success(`Exported ${rows.length} record${rows.length === 1 ? "" : "s"}`);
    } catch (e) {
      toast.warning(e instanceof Error ? e.message : "Export failed");
    } finally {
      setExporting(null);
    }
  };

  const toggleSelected = (id: string) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // ── the danger zone: PIN-confirmed deletion ──

  const dangerLabel = (d: DangerTarget): string => {
    switch (d.kind) {
      case "delete_upload":
        return `Delete this evidence from ${d.upload.lga}, ${d.upload.state}, its photo and its tallies`;
      case "delete_election":
        return `Delete "${d.election.title}" with every candidate, sheet and tally in it`;
      case "delete_access":
        return `Delete ${d.access.users?.full_name || "this user"}'s election access record`;
      case "clear_audit":
        return "Clear the entire moderation ledger";
      case "purge_all":
        return "PURGE EVERYTHING: all elections, evidence, tallies, access records and the ledger";
    }
  };

  const runDanger = async () => {
    if (!danger) return;
    setDangerBusy(true);
    const payload: Record<string, unknown> = { pin: dangerPin };
    if (danger.kind === "delete_upload") {
      payload.action = "delete_upload";
      payload.uploadId = danger.upload.id;
    } else if (danger.kind === "delete_election") {
      payload.action = "delete_election";
      payload.electionId = danger.election.id;
    } else if (danger.kind === "delete_access") {
      payload.action = "delete_access";
      payload.userId = danger.access.user_id;
    } else {
      payload.action = danger.kind;
    }
    try {
      const { res, data } = await authFetchJson("/api/admin/elections", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      if (!res.ok || !data?.ok) throw new Error(data?.error || "Delete failed");
      // Deletions mutate too much to patch piecemeal; one clean refetch.
      await load();
      toast.success("Deleted");
      setDanger(null);
      setDangerPin("");
    } catch (e) {
      toast.warning(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setDangerBusy(false);
    }
  };

  if (!loaded) {
    return (
      <div
        className="flex justify-center"
        style={{ paddingTop: "calc(var(--app-top-inset, 0px) + 9rem)" }}
      >
        <PejaSpinner />
      </div>
    );
  }

  return (
    <div
      className="px-4 pb-24 max-w-3xl mx-auto space-y-8"
      style={{ paddingTop: "calc(var(--app-top-inset, 0px) + 6rem)" }}
    >
      <div>
        <h1 className="text-xl font-bold text-dark-50">Election Watch</h1>
        <p className="text-xs text-dark-400">
          Moderation is instant and reversible. Deletion lives at the bottom
          and asks for your PIN every single time.
        </p>
      </div>

      {/* elections */}
      <section>
        <h2 className="text-sm font-semibold text-dark-400 uppercase mb-3">Elections</h2>
        <div className="space-y-2">
          {elections.map((e) => (
            <div
              key={e.id}
              className="p-3 rounded-xl bg-dark-800/50 border border-dark-700 space-y-2.5"
            >
              <div className="flex items-center gap-2">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-dark-100 truncate">{e.title}</p>
                <p className="text-xs text-dark-500">
                  by {e.users?.full_name || "Unknown"} ·{" "}
                  {e.status === "active" ? (
                    <span className="beacon-ok-text">active</span>
                  ) : (
                    <span className="beacon-wait-text">closed</span>
                  )}
                </p>
              </div>
              <button
                onClick={() => toggleElection(e)}
                className="px-3 py-1.5 rounded-lg bg-[var(--soft-surface-strong)] text-dark-200 text-xs font-medium flex items-center gap-1 active:scale-[0.97] transition-transform"
              >
                {e.status === "active" ? (
                  <>
                    <XCircle className="w-3.5 h-3.5" /> Close
                  </>
                ) : (
                  <>
                    <RotateCcw className="w-3.5 h-3.5" /> Reopen
                  </>
                )}
              </button>
              <button
                onClick={() => setDanger({ kind: "delete_election", election: e })}
                aria-label="Delete election"
                className="p-2 rounded-lg bg-[var(--soft-surface)] beacon-bad-text active:scale-[0.97] transition-transform"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
              </div>

              {/* candidates: tap the pencil to edit name, photo, notes */}
              {candidates.filter((c) => c.election_id === e.id).length > 0 && (
                <div className="flex gap-1.5 overflow-x-auto pb-0.5">
                  {candidates
                    .filter((c) => c.election_id === e.id)
                    .map((c) => (
                      <button
                        key={c.id}
                        onClick={() => setEditCandidate(c)}
                        className="shrink-0 flex items-center gap-1.5 pl-1 pr-2 py-1 rounded-full bg-[var(--soft-surface)] border border-[var(--hairline)] active:scale-[0.97] transition-transform"
                      >
                        {c.photo_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={c.photo_url}
                            alt=""
                            className="w-6 h-6 rounded-full object-cover"
                          />
                        ) : (
                          <span className="w-6 h-6 rounded-full bg-primary-600/30 text-[10px] font-bold text-primary-300 flex items-center justify-center">
                            {c.name[0]}
                          </span>
                        )}
                        <span className="text-[11px] text-dark-200 max-w-28 truncate">{c.name}</span>
                        <Pencil className="w-3 h-3 text-dark-500" />
                      </button>
                    ))}
                </div>
              )}
            </div>
          ))}
          {elections.length === 0 && <p className="text-sm text-dark-500">No elections yet.</p>}
        </div>
      </section>

      {/* uploads */}
      <section>
        <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
          <h2 className="text-sm font-semibold text-dark-400 uppercase">
            Evidence ({uploads.length})
          </h2>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => {
                setSelectMode((v) => !v);
                setSelectedIds(new Set());
              }}
              className="px-2.5 py-1.5 rounded-lg bg-[var(--soft-surface)] text-dark-200 text-xs font-medium active:scale-[0.97] transition-transform"
            >
              {selectMode ? "Cancel" : "Select"}
            </button>
            {selectMode && selectedIds.size > 0 && (
              <button
                disabled={!!exporting}
                onClick={() => exportZip(uploads.filter((u) => selectedIds.has(u.id)))}
                className="px-2.5 py-1.5 rounded-lg bg-primary-600 text-white text-xs font-medium active:scale-[0.97] transition-transform"
              >
                {exporting ? `Zipping ${exporting}` : `Download ${selectedIds.size}`}
              </button>
            )}
            {!selectMode && uploads.length > 0 && (
              <>
                <button
                  disabled={!!exporting}
                  onClick={() => exportZip(uploads)}
                  className="px-2.5 py-1.5 rounded-lg bg-primary-600 text-white text-xs font-medium flex items-center gap-1 active:scale-[0.97] transition-transform"
                >
                  <Download className="w-3.5 h-3.5" />
                  {exporting ? `Zipping ${exporting}` : "Download all"}
                </button>
                <button
                  onClick={() => exportCsv(uploads)}
                  className="px-2.5 py-1.5 rounded-lg bg-[var(--soft-surface)] text-dark-200 text-xs font-medium flex items-center gap-1 active:scale-[0.97] transition-transform"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5" /> Fingerprints CSV
                </button>
              </>
            )}
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {uploads.map((u) => (
            <div
              key={u.id}
              className="rounded-xl overflow-hidden bg-dark-800/50 border border-dark-700"
            >
              <button
                onClick={() => (selectMode ? toggleSelected(u.id) : setDetailUpload(u))}
                className="relative block w-full aspect-video bg-black active:scale-[0.99] transition-transform"
                aria-label={selectMode ? "Select this record" : "Open the full record"}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={u.photo_url}
                  alt="Sheet"
                  className={`absolute inset-0 w-full h-full object-cover ${u.hidden ? "opacity-30" : ""}`}
                  loading="lazy"
                />
                {selectMode && (
                  <span
                    className={`absolute top-1.5 left-1.5 w-5 h-5 rounded-md border-2 flex items-center justify-center ${
                      selectedIds.has(u.id)
                        ? "bg-primary-600 border-primary-400"
                        : "bg-black/50 border-white/50"
                    }`}
                  >
                    {selectedIds.has(u.id) && <Check className="w-3.5 h-3.5 text-white" />}
                  </span>
                )}
                {u.hidden && (
                  <span className="absolute inset-0 flex items-center justify-center text-[10px] font-semibold text-red-300 px-2 text-center">
                    HIDDEN: {u.hidden_reason}
                    {talliedIds.has(u.id) && !u.tallies_hidden && (
                      <span className="block text-amber-300">(tally still counts)</span>
                    )}
                  </span>
                )}
              </button>
              <div className="p-2 space-y-1">
                <p className="text-[11px] text-dark-300 truncate">
                  {u.lga}, {u.state}
                  {u.polling_unit ? ` · ${u.polling_unit}` : ""}
                  {talliedIds.has(u.id) && (
                    <span className="beacon-ok-text"> · tallied</span>
                  )}
                </p>
                <p className="text-[10px] text-dark-500 truncate">
                  by {u.users?.full_name || "Unknown"}
                </p>
                <div className="flex items-center gap-1">
                  {u.device_lat != null && u.device_lng != null && (
                    <a
                      href={`https://maps.google.com/?q=${u.device_lat},${u.device_lng}`}
                      target="_blank"
                      rel="noreferrer"
                      className="p-1.5 rounded-lg bg-[var(--soft-surface)] text-dark-300"
                      title="Where the phone was at upload"
                    >
                      <MapPin className="w-3.5 h-3.5" />
                    </a>
                  )}
                  {u.hidden ? (
                    <button
                      onClick={() => unhideUpload(u)}
                      className="flex-1 py-1.5 rounded-lg bg-[var(--soft-surface)] text-dark-200 text-[10px] font-medium flex items-center justify-center gap-1 active:scale-[0.97] transition-transform"
                    >
                      <Eye className="w-3 h-3" /> Unhide
                    </button>
                  ) : (
                    <button
                      onClick={() => {
                        setHideTarget(u);
                        setHideReason("");
                        setHideTally(true);
                      }}
                      className="flex-1 py-1.5 rounded-lg bg-[var(--soft-surface)] beacon-wait-text text-[10px] font-medium flex items-center justify-center gap-1 active:scale-[0.97] transition-transform"
                    >
                      <EyeOff className="w-3 h-3" /> Hide
                    </button>
                  )}
                  <button
                    onClick={() => setDanger({ kind: "delete_upload", upload: u })}
                    aria-label="Delete evidence"
                    className="p-1.5 rounded-lg bg-[var(--soft-surface)] beacon-bad-text active:scale-[0.97] transition-transform"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
        {uploads.length === 0 && <p className="text-sm text-dark-500">No uploads yet.</p>}
      </section>

      {/* access */}
      <section>
        <h2 className="text-sm font-semibold text-dark-400 uppercase mb-3">Election access</h2>
        <div className="space-y-2">
          {access.map((a) => (
            <div
              key={a.user_id}
              className="flex items-center gap-2 p-3 rounded-xl bg-dark-800/50 border border-dark-700 flex-wrap"
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-dark-100 truncate">
                  {a.users?.full_name || "Unknown"}
                  <span className="text-xs text-dark-500">
                    {" "}
                    ({a.users?.is_mvp ? "MVP" : a.users?.is_vip ? "VIP" : "user"})
                  </span>
                </p>
                <p className="text-xs text-dark-500">
                  {a.frozen
                    ? "Frozen"
                    : a.locked_at
                      ? `Locked (${a.failed_attempts} failed PINs)`
                      : a.failed_attempts > 0
                        ? `${a.failed_attempts} failed PIN attempt${a.failed_attempts === 1 ? "" : "s"}`
                        : "OK"}
                </p>
              </div>
              {a.locked_at && (
                <button
                  onClick={() => unlockPin(a)}
                  className="px-2.5 py-1.5 rounded-lg bg-[var(--soft-surface)] beacon-ok-text text-xs font-medium flex items-center gap-1 active:scale-[0.97] transition-transform"
                >
                  <LockOpen className="w-3.5 h-3.5" /> Unlock
                </button>
              )}
              <button
                onClick={() => resetPin(a)}
                className="px-2.5 py-1.5 rounded-lg bg-[var(--soft-surface)] text-dark-300 text-xs font-medium flex items-center gap-1 active:scale-[0.97] transition-transform"
              >
                <Lock className="w-3.5 h-3.5" /> Reset PIN
              </button>
              <button
                onClick={() => toggleFreeze(a)}
                className={`px-2.5 py-1.5 rounded-lg bg-[var(--soft-surface)] text-xs font-medium flex items-center gap-1 active:scale-[0.97] transition-transform ${
                  a.frozen ? "beacon-ok-text" : "beacon-bad-text"
                }`}
              >
                {a.frozen ? (
                  <>
                    <ShieldCheck className="w-3.5 h-3.5" /> Unfreeze
                  </>
                ) : (
                  <>
                    <ShieldOff className="w-3.5 h-3.5" /> Freeze
                  </>
                )}
              </button>
              <button
                onClick={() => setDanger({ kind: "delete_access", access: a })}
                aria-label="Delete access record"
                className="p-2 rounded-lg bg-[var(--soft-surface)] beacon-bad-text active:scale-[0.97] transition-transform"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
          {access.length === 0 && (
            <p className="text-sm text-dark-500">Nobody has set an election PIN yet.</p>
          )}
        </div>
      </section>

      {/* ledger */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-dark-400 uppercase">Moderation ledger</h2>
          {audit.length > 0 && (
            <button
              onClick={() => setDanger({ kind: "clear_audit" })}
              className="px-2.5 py-1.5 rounded-lg bg-[var(--soft-surface)] beacon-bad-text text-xs font-medium flex items-center gap-1 active:scale-[0.97] transition-transform"
            >
              <Trash2 className="w-3.5 h-3.5" /> Clear
            </button>
          )}
        </div>
        <div className="space-y-1.5">
          {audit.map((row) => (
            <div
              key={row.id}
              className="px-3 py-2 rounded-lg bg-[var(--soft-surface)] text-xs text-dark-400"
            >
              <span className="text-dark-200 font-medium">{row.users?.full_name || "Admin"}</span>{" "}
              {row.action.replace(/_/g, " ")}{" "}
              <span className="text-dark-500">{new Date(row.created_at).toLocaleString()}</span>
              {typeof row.subject?.reason === "string" && (
                <span className="text-dark-500"> · &quot;{row.subject.reason}&quot;</span>
              )}
            </div>
          ))}
          {audit.length === 0 && <p className="text-sm text-dark-500">No actions yet.</p>}
        </div>
      </section>

      {/* danger zone */}
      <section className="rounded-2xl border border-red-500/25 bg-red-500/5 p-4">
        <h2 className="text-sm font-semibold beacon-bad-text uppercase mb-1">Danger zone</h2>
        <p className="text-xs text-dark-400 mb-3">
          Every delete asks for your admin PIN again. There is no undo.
        </p>
        <button
          onClick={() => setDanger({ kind: "purge_all" })}
          className="px-4 py-2.5 rounded-xl bg-red-600/90 text-white text-sm font-semibold flex items-center gap-2 active:scale-[0.97] transition-transform"
        >
          <TriangleAlert className="w-4 h-4" /> Purge everything
        </button>
      </section>

      {/* full evidence record */}
      {detailUpload && (
        <EvidenceDetailModal
          upload={detailUpload}
          tallies={tallies.filter((t) => t.upload_id === detailUpload.id)}
          candidates={candidates}
          onZoom={(url) => setZoomedPhoto(url)}
          onClose={() => setDetailUpload(null)}
        />
      )}

      {/* candidate editing */}
      {editCandidate && (
        <EditCandidateModal
          candidate={editCandidate}
          onClose={() => setEditCandidate(null)}
          onSaved={(updated) => {
            setCandidates((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
            setEditCandidate(null);
          }}
        />
      )}

      {/* hide-with-reason + tally toggle */}
      {hideTarget && (
        <Modal isOpen onClose={() => setHideTarget(null)} title="Hide this evidence">
          <div className="space-y-3">
            <p className="text-xs text-dark-400 leading-relaxed">
              Everything about this sheet disappears from public view: the
              photo, the uploader, the polling unit and the tally details.
              The reason you give is shown in its place, and the record
              itself is preserved.
            </p>
            <input
              value={hideReason}
              onChange={(e) => setHideReason(e.target.value)}
              maxLength={300}
              autoFocus
              placeholder="Public reason, e.g. Not a result sheet"
              className="w-full glass-input rounded-xl px-4 text-sm text-dark-100 placeholder:text-dark-500"
            />
            {talliedIds.has(hideTarget.id) && (
              <button
                onClick={() => setHideTally((v) => !v)}
                className="w-full flex items-center gap-3 p-3 rounded-xl bg-[var(--soft-surface)] border border-[var(--hairline)] active:scale-[0.98] transition-transform"
              >
                <div className="flex-1 text-left">
                  <p className="text-sm font-medium text-dark-100">Also remove its tally from totals</p>
                  <p className="text-xs text-dark-500">
                    {hideTally
                      ? "The numbers leave the count with the evidence"
                      : "The count keeps the numbers, only the evidence is withheld"}
                  </p>
                </div>
                <div
                  className={`relative w-[42px] h-[26px] rounded-full transition-colors duration-300 shrink-0 ${
                    hideTally ? "bg-red-500" : "bg-dark-600"
                  }`}
                >
                  <span
                    className="absolute top-[3px] w-[20px] h-[20px] rounded-full bg-white shadow-md"
                    style={{ left: hideTally ? 19 : 3, transition: "left 0.3s var(--ease-spring)" }}
                  />
                </div>
              </button>
            )}
            <button
              disabled={!hideReason.trim()}
              onClick={() => {
                hideUpload(hideTarget, hideReason.trim(), hideTally);
                setHideTarget(null);
              }}
              className="w-full py-3 rounded-2xl bg-amber-600 text-white text-sm font-semibold active:scale-[0.97] transition-transform disabled:opacity-40"
            >
              Hide with this reason
            </button>
          </div>
        </Modal>
      )}

      {/* danger confirm: fresh PIN every time */}
      {danger && (
        <Modal
          isOpen
          onClose={() => {
            if (!dangerBusy) {
              setDanger(null);
              setDangerPin("");
            }
          }}
          title="Confirm deletion"
        >
          <div className="space-y-3">
            <div className="flex items-start gap-2.5 p-3 rounded-xl bg-red-500/10 border border-red-500/25">
              <TriangleAlert className="beacon-bad-text w-4 h-4 shrink-0 mt-0.5" />
              <p className="text-sm text-dark-200 leading-relaxed">{dangerLabel(danger)}.</p>
            </div>
            <p className="text-xs text-dark-500">
              This cannot be undone. Enter your admin PIN to proceed.
            </p>
            <input
              type="password"
              inputMode="numeric"
              value={dangerPin}
              onChange={(e) => setDangerPin(e.target.value)}
              autoFocus
              placeholder="Admin PIN"
              className="w-full glass-input rounded-xl px-4 py-3 text-center text-lg tracking-[0.3em] text-dark-100 placeholder:text-dark-600"
            />
            <button
              disabled={dangerBusy || !dangerPin}
              onClick={runDanger}
              className="w-full py-3 rounded-2xl bg-red-600 text-white text-sm font-semibold active:scale-[0.97] transition-transform disabled:opacity-40 flex items-center justify-center gap-2"
            >
              {dangerBusy ? <PejaSpinner className="w-4 h-4" /> : <Trash2 className="w-4 h-4" />}
              {dangerBusy ? "Deleting..." : "Delete permanently"}
            </button>
          </div>
        </Modal>
      )}

      {zoomedPhoto && (
        <ImageLightbox isOpen onClose={() => setZoomedPhoto(null)} imageUrl={zoomedPhoto} />
      )}
    </div>
  );
}

// Edit a candidate: name, description, photo. Admin only; the change is
// stamped into the moderation ledger by the server.
function EditCandidateModal({
  candidate,
  onClose,
  onSaved,
}: {
  candidate: AdminCandidate;
  onClose: () => void;
  onSaved: (c: AdminCandidate) => void;
}) {
  const toast = useToast();
  const [name, setName] = useState(candidate.name);
  const [description, setDescription] = useState(candidate.description || "");
  const [photo, setPhoto] = useState<string | null>(null); // new photo data URL
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      const { res, data } = await authFetchJson("/api/admin/elections", {
        method: "POST",
        body: JSON.stringify({
          action: "edit_candidate",
          candidateId: candidate.id,
          name: name.trim(),
          description: description.trim(),
          ...(photo ? { photoDataUrl: photo } : {}),
        }),
      });
      if (!res.ok || !data?.ok) throw new Error(data?.error || "Could not save");
      toast.success("Candidate updated");
      onSaved(data.candidate as AdminCandidate);
    } catch (e) {
      toast.warning(e instanceof Error ? e.message : "Could not save");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal isOpen onClose={busy ? () => {} : onClose} title="Edit candidate">
      <div className="space-y-3">
        <div className="flex items-center gap-3">
          {photo || candidate.photo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={photo || candidate.photo_url || ""}
              alt=""
              className="w-14 h-14 rounded-full object-cover border border-[var(--hairline-strong)]"
            />
          ) : (
            <span className="w-14 h-14 rounded-full bg-primary-600/30 text-lg font-bold text-primary-300 flex items-center justify-center">
              {name[0] || "?"}
            </span>
          )}
          <label className="flex-1">
            <span className="text-xs text-dark-500">Change photo</span>
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
        </div>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={120}
          placeholder="Candidate name"
          className="w-full glass-input rounded-xl px-4 text-sm text-dark-100 placeholder:text-dark-500"
        />
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={1000}
          rows={2}
          placeholder="Party / description"
          className="w-full glass-input rounded-xl px-4 py-3 text-sm text-dark-100 placeholder:text-dark-500 resize-none"
        />
        <button
          onClick={save}
          disabled={busy || name.trim().length < 2}
          className="w-full py-3 rounded-2xl bg-primary-600 text-white text-sm font-semibold active:scale-[0.97] transition-transform disabled:opacity-40 flex items-center justify-center gap-2"
        >
          {busy ? <PejaSpinner className="w-4 h-4" /> : null}
          Save changes
        </button>
      </div>
    </Modal>
  );
}

// The full record of one sheet: photo, provenance, geography, figures and
// every correction. This is the admin's microscope; identity here is
// intentionally complete.
function EvidenceDetailModal({
  upload,
  tallies,
  candidates,
  onZoom,
  onClose,
}: {
  upload: AdminUpload;
  tallies: AdminTally[];
  candidates: AdminCandidate[];
  onZoom: (url: string) => void;
  onClose: () => void;
}) {
  const toast = useToast();
  const nameOf = (cid: string) => candidates.find((c) => c.id === cid)?.name || "Candidate";
  // The fingerprint starts abbreviated; tapping shows all 64 characters
  // and a copy control, for pasting straight into a shasum comparison.
  const [showFullHash, setShowFullHash] = useState(false);
  return (
    <Modal isOpen onClose={onClose} title="Evidence record">
      <div className="space-y-3">
        <button
          onClick={() => onZoom(upload.photo_url)}
          className="block w-full rounded-2xl overflow-hidden border border-[var(--glass-border)] active:scale-[0.99] transition-transform"
          aria-label="Expand the photo"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={upload.photo_url} alt="Result sheet" className="w-full max-h-72 object-contain bg-black" />
        </button>

        <div className="rounded-xl bg-[var(--soft-surface)] border border-[var(--hairline)] divide-y divide-[var(--hairline)] text-sm">
          <div className="px-3.5 py-2.5 flex justify-between gap-3">
            <span className="text-dark-500 shrink-0">Claimed location</span>
            <span className="text-dark-100 text-right">
              {upload.lga}, {upload.state}
              {upload.polling_unit ? `, ${upload.polling_unit}` : ""}
            </span>
          </div>
          <div className="px-3.5 py-2.5 flex justify-between gap-3">
            <span className="text-dark-500 shrink-0">Uploaded by</span>
            <span className="text-dark-100 text-right">
              {upload.users?.full_name || "Unknown"}
              <span className="block text-[11px] text-dark-500">
                {new Date(upload.created_at).toLocaleString()}
              </span>
            </span>
          </div>
          <div className="px-3.5 py-2.5 flex justify-between gap-3">
            <span className="text-dark-500 shrink-0">Phone was at</span>
            {upload.device_lat != null && upload.device_lng != null ? (
              <a
                href={`https://maps.google.com/?q=${upload.device_lat},${upload.device_lng}`}
                target="_blank"
                rel="noreferrer"
                className="beacon-accent-text text-right underline"
              >
                {upload.device_lat.toFixed(4)}, {upload.device_lng.toFixed(4)}
              </a>
            ) : (
              <span className="text-dark-400">Not captured</span>
            )}
          </div>
          <div className="px-3.5 py-2.5 flex justify-between gap-3">
            <span className="text-dark-500 shrink-0">Status</span>
            <span className={`text-right ${upload.hidden ? "beacon-wait-text" : "beacon-ok-text"}`}>
              {upload.hidden
                ? `Hidden: ${upload.hidden_reason}${upload.tallies_hidden ? " (tally excluded)" : " (tally still counts)"}`
                : "Public"}
            </span>
          </div>
          <div className="px-3.5 py-2.5">
            <div className="flex justify-between gap-3">
              <span className="text-dark-500 shrink-0">Fingerprint</span>
              <button
                onClick={() => setShowFullHash((v) => !v)}
                className="text-dark-400 text-right font-mono text-[11px] break-all active:opacity-70"
                aria-label={showFullHash ? "Collapse fingerprint" : "Show full fingerprint"}
              >
                {showFullHash ? upload.photo_sha256 : `${upload.photo_sha256.slice(0, 24)}... tap for all`}
              </button>
            </div>
            {showFullHash && (
              <button
                onClick={() => {
                  navigator.clipboard
                    .writeText(upload.photo_sha256)
                    .then(() => toast.success("Fingerprint copied"))
                    .catch(() => toast.warning("Could not copy"));
                }}
                className="mt-1.5 ml-auto block px-2.5 py-1 rounded-lg bg-[var(--soft-surface)] text-dark-200 text-[11px] font-medium active:scale-[0.97] transition-transform"
              >
                Copy
              </button>
            )}
          </div>
        </div>

        {tallies.length === 0 ? (
          <p className="text-sm text-dark-500 text-center py-2">Not tallied yet.</p>
        ) : (
          <div className="space-y-2">
            {tallies.map((t) => (
              <div
                key={t.id}
                className={`p-3 rounded-xl border ${
                  t.superseded_by
                    ? "bg-[var(--soft-surface)] border-[var(--hairline)] opacity-60"
                    : "bg-dark-800/50 border-dark-700"
                }`}
              >
                <p className="text-[11px] text-dark-500 mb-1.5">
                  {t.superseded_by ? "Superseded" : "Current"} tally by{" "}
                  <span className="text-dark-200">{t.users?.full_name || "Unknown"}</span>{" "}
                  {new Date(t.created_at).toLocaleString()}
                  {t.device_lat != null && t.device_lng != null && (
                    <>
                      {" "}
                      <a
                        href={`https://maps.google.com/?q=${t.device_lat},${t.device_lng}`}
                        target="_blank"
                        rel="noreferrer"
                        className="beacon-accent-text underline"
                      >
                        tallied from here
                      </a>
                    </>
                  )}
                  {t.note ? ` · "${t.note}"` : ""}
                </p>
                <div className="space-y-0.5">
                  {Object.entries(t.figures || {}).map(([cid, votes]) => (
                    <div key={cid} className="flex justify-between text-sm">
                      <span className="text-dark-300">{nameOf(cid)}</span>
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
      </div>
    </Modal>
  );
}
