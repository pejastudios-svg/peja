"use client";

// Admin queue for user reports. Lists pending reports first, with
// tabs to flip to dismissed / actioned history. Each row exposes
// the canonical moderation actions:
//
//   • Dismiss            — no account action; mark report closed
//                          with optional admin note.
//   • Suspend            — flip users.status → suspended via the
//                          existing /api/admin/set-user-status route,
//                          THEN mark the report as actioned.
//   • Ban                — same path, with status = banned.
//   • Revoke VIP         — toggles is_vip off via the existing
//                          /api/admin/set-vip-status route.
//   • Delete user        — out of scope here; admin/users page
//                          owns the destructive deletion flow.
//
// Each action surfaces a small modal that captures the admin notes
// + (for suspend) an optional end date. The note is written to
// BOTH user_reports.admin_notes AND the user-side reason column
// (suspension_reason / ban_reason) so the audit trail is symmetric.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/lib/supabase";
import { AvatarImage } from "@/components/ui/AvatarImage";
import { Flag, User, Ban, Clock, ShieldOff, X, MessageCircle, Star } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

type ReportStatus = "pending" | "dismissed" | "actioned";

interface UserSummary {
  id: string;
  full_name: string | null;
  avatar_url: string | null;
}

interface ReportedSummary extends UserSummary {
  is_vip: boolean | null;
  is_mvp: boolean | null;
  status: string | null;
}

interface ReportRow {
  id: string;
  reporter_id: string;
  reported_id: string;
  conversation_id: string | null;
  reason: string;
  notes: string | null;
  status: ReportStatus;
  admin_notes: string | null;
  action_taken: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
  reporter: UserSummary | null;
  reported: ReportedSummary | null;
}

type ActionKind = "dismiss" | "suspend" | "ban" | "revoke-vip" | "revoke-mvp";

interface PendingAction {
  kind: ActionKind;
  report: ReportRow;
}

const REASON_LABELS: Record<string, string> = {
  spam: "Spam or scam",
  harassment: "Harassment",
  hate: "Hate speech",
  explicit: "Explicit content",
  impersonation: "Impersonation",
  self_harm: "Self-harm",
  other: "Other",
};

export default function AdminReportsPage() {
  const { user } = useAuth();
  const [tab, setTab] = useState<ReportStatus>("pending");
  const [rows, setRows] = useState<ReportRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);

  const authHeader = useCallback(async (): Promise<Record<string, string>> => {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    return token ? { Authorization: `Bearer ${token}` } : {};
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const h = await authHeader();
      const res = await fetch(`/api/admin/reports/list?status=${tab}`, {
        headers: h,
      });
      const json = await res.json();
      if (json.ok) setRows(json.reports as ReportRow[]);
    } finally {
      setLoading(false);
    }
  }, [tab, authHeader]);

  useEffect(() => {
    if (!user) return;
    void refresh();
  }, [user, refresh]);

  const counts = useMemo(
    () => ({ pending: rows.filter((r) => r.status === "pending").length }),
    [rows]
  );

  return (
    <div className="px-4 lg:px-8 py-6 max-w-6xl mx-auto">
      <header className="flex items-center gap-3 mb-6">
        <Flag className="w-6 h-6 text-red-400" />
        <h1 className="text-xl font-bold text-dark-100">User reports</h1>
      </header>

      <div className="flex gap-1 mb-4 border-b border-white/10">
        {(["pending", "dismissed", "actioned"] as ReportStatus[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === t
                ? "text-primary-400 border-primary-500"
                : "text-dark-400 border-transparent hover:text-dark-200"
            }`}
          >
            {t.charAt(0).toUpperCase() + t.slice(1)}
            {t === tab && rows.length > 0 && (
              <span className="ml-1.5 text-[11px] text-dark-400">
                ({rows.length})
              </span>
            )}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-sm text-dark-400 py-12 text-center">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-dark-400 py-12 text-center">
          No reports in this tab.
        </p>
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => (
            <ReportCard
              key={r.id}
              report={r}
              onAction={(kind) => setPendingAction({ kind, report: r })}
            />
          ))}
        </ul>
      )}

      {pendingAction && (
        <ActionModal
          action={pendingAction}
          onClose={() => setPendingAction(null)}
          onApplied={() => {
            setPendingAction(null);
            void refresh();
          }}
          authHeader={authHeader}
        />
      )}

      {/* Quiet pending-count hint at the bottom so the layout's nav
          badge can stay in sync without a separate fetch. */}
      <p className="sr-only">{counts.pending} pending</p>
    </div>
  );
}

function ReportCard({
  report,
  onAction,
}: {
  report: ReportRow;
  onAction: (kind: ActionKind) => void;
}) {
  const reportedIsVip = report.reported?.is_vip === true;
  const reportedIsMvp = report.reported?.is_mvp === true;
  const reportedStatus = report.reported?.status || "active";
  const closed = report.status !== "pending";

  return (
    <li className="rounded-xl bg-white/5 border border-white/10 p-4">
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0 space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-red-500/15 text-red-300 font-medium">
              <Flag className="w-3 h-3" />
              {REASON_LABELS[report.reason] || report.reason}
            </span>
            <span className="text-[11px] text-dark-400 inline-flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {formatDistanceToNow(new Date(report.created_at), { addSuffix: true })}
            </span>
            {report.conversation_id && (
              <span className="text-[11px] text-dark-400 inline-flex items-center gap-1">
                <MessageCircle className="w-3 h-3" />
                from chat
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <UserPill label="Reporter" user={report.reporter} />
            <UserPill
              label="Reported"
              user={report.reported}
              extra={
                <span className="inline-flex items-center gap-1">
                  {reportedIsMvp && (
                    <span className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-300">
                      <Star className="w-2.5 h-2.5" />
                      MVP
                    </span>
                  )}
                  {reportedIsVip && (
                    <span className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full bg-primary-500/20 text-primary-300">
                      <Star className="w-2.5 h-2.5" />
                      VIP
                    </span>
                  )}
                  {reportedStatus !== "active" && (
                    <span
                      className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                        reportedStatus === "banned"
                          ? "bg-red-500/20 text-red-300"
                          : "bg-amber-500/20 text-amber-300"
                      }`}
                    >
                      {reportedStatus}
                    </span>
                  )}
                </span>
              }
            />
          </div>

          {report.notes && (
            <div className="text-sm text-dark-200 whitespace-pre-wrap bg-black/20 rounded-lg px-3 py-2 border border-white/5">
              {report.notes}
            </div>
          )}

          {closed && (
            <div className="text-xs text-dark-400 space-y-1 pt-1 border-t border-white/5 mt-2">
              <p>
                <span className="font-medium text-dark-300">Outcome:</span>{" "}
                {report.action_taken || (report.status === "dismissed" ? "Dismissed" : "-")}
              </p>
              {report.admin_notes && (
                <p>
                  <span className="font-medium text-dark-300">Admin notes:</span>{" "}
                  <span className="whitespace-pre-wrap">{report.admin_notes}</span>
                </p>
              )}
              {report.reviewed_at && (
                <p className="text-dark-500">
                  Reviewed {formatDistanceToNow(new Date(report.reviewed_at), { addSuffix: true })}
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      {!closed && (
        <div className="flex flex-wrap gap-2 mt-4 pt-3 border-t border-white/5">
          <button
            type="button"
            onClick={() => onAction("dismiss")}
            className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-dark-200 text-xs font-medium border border-white/10"
          >
            Dismiss
          </button>
          <button
            type="button"
            onClick={() => onAction("suspend")}
            className="px-3 py-1.5 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 text-xs font-medium inline-flex items-center gap-1"
          >
            <Clock className="w-3.5 h-3.5" />
            Suspend
          </button>
          <button
            type="button"
            onClick={() => onAction("ban")}
            className="px-3 py-1.5 rounded-lg bg-red-500/15 hover:bg-red-500/25 text-red-300 text-xs font-medium inline-flex items-center gap-1"
          >
            <Ban className="w-3.5 h-3.5" />
            Ban
          </button>
          {reportedIsMvp && (
            <button
              type="button"
              onClick={() => onAction("revoke-mvp")}
              className="px-3 py-1.5 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 text-xs font-medium inline-flex items-center gap-1"
            >
              <ShieldOff className="w-3.5 h-3.5" />
              Revoke MVP
            </button>
          )}
          {reportedIsVip && (
            <button
              type="button"
              onClick={() => onAction("revoke-vip")}
              className="px-3 py-1.5 rounded-lg bg-primary-500/15 hover:bg-primary-500/25 text-primary-300 text-xs font-medium inline-flex items-center gap-1"
            >
              <ShieldOff className="w-3.5 h-3.5" />
              Revoke VIP
            </button>
          )}
        </div>
      )}
    </li>
  );
}

function UserPill({
  label,
  user,
  extra,
}: {
  label: string;
  user: UserSummary | null;
  extra?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2 min-w-0">
      <AvatarImage
        src={user?.avatar_url}
        wrapperClassName="w-9 h-9 rounded-full overflow-hidden bg-primary-600/20 flex items-center justify-center shrink-0"
        fallback={<User className="w-4 h-4 text-primary-300" />}
      />
      <div className="min-w-0">
        <p className="text-[10px] uppercase tracking-wider text-dark-500">
          {label}
        </p>
        <p className="text-sm text-dark-100 truncate">
          {user?.full_name || "Unknown"}
        </p>
        {extra}
      </div>
    </div>
  );
}

function ActionModal({
  action,
  onClose,
  onApplied,
  authHeader,
}: {
  action: PendingAction;
  onClose: () => void;
  onApplied: () => void;
  authHeader: () => Promise<Record<string, string>>;
}) {
  const [notes, setNotes] = useState("");
  const [until, setUntil] = useState(""); // datetime-local for suspend
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const { kind, report } = action;
  const reportedName = report.reported?.full_name || "this user";

  const title =
    kind === "dismiss"
      ? "Dismiss report"
      : kind === "suspend"
        ? `Suspend ${reportedName}`
        : kind === "ban"
          ? `Ban ${reportedName}`
          : kind === "revoke-mvp"
            ? `Revoke MVP for ${reportedName}`
            : `Revoke VIP for ${reportedName}`;

  const submit = async () => {
    if (submitting) return;
    setSubmitting(true);
    setErr(null);
    try {
      const headers = {
        "Content-Type": "application/json",
        ...(await authHeader()),
      };
      const trimmedNotes = notes.trim() || null;
      let actionTaken: string | null = null;

      if (kind === "suspend") {
        const body = {
          userId: report.reported_id,
          status: "suspended",
          reason: trimmedNotes,
          suspendedUntil: until || null,
        };
        const res = await fetch("/api/admin/set-user-status", {
          method: "POST",
          headers,
          body: JSON.stringify(body),
        });
        const json = await res.json();
        if (!json.ok) throw new Error(json.error || "Suspend failed");
        actionTaken = until
          ? `Suspended until ${new Date(until).toLocaleString()}`
          : "Suspended (indefinite)";
      } else if (kind === "ban") {
        const res = await fetch("/api/admin/set-user-status", {
          method: "POST",
          headers,
          body: JSON.stringify({
            userId: report.reported_id,
            status: "banned",
            reason: trimmedNotes,
          }),
        });
        const json = await res.json();
        if (!json.ok) throw new Error(json.error || "Ban failed");
        actionTaken = "Banned";
      } else if (kind === "revoke-vip") {
        const res = await fetch("/api/admin/set-vip-status", {
          method: "POST",
          headers,
          body: JSON.stringify({ userId: report.reported_id, value: false }),
        });
        const json = await res.json();
        if (!json.ok) throw new Error(json.error || "Revoke VIP failed");
        actionTaken = "VIP revoked";
      } else if (kind === "revoke-mvp") {
        const res = await fetch("/api/admin/set-mvp-status", {
          method: "POST",
          headers,
          body: JSON.stringify({ userId: report.reported_id, value: false }),
        });
        const json = await res.json();
        if (!json.ok) throw new Error(json.error || "Revoke MVP failed");
        actionTaken = "MVP revoked";
      }

      // Either way, stamp the report row.
      const reportRes = await fetch("/api/admin/reports/update", {
        method: "POST",
        headers,
        body: JSON.stringify({
          reportId: report.id,
          status: kind === "dismiss" ? "dismissed" : "actioned",
          adminNotes: trimmedNotes,
          actionTaken: actionTaken,
        }),
      });
      const reportJson = await reportRes.json();
      if (!reportJson.ok) throw new Error(reportJson.error || "Update failed");

      onApplied();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Action failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-[80] bg-black/60 flex items-center justify-center p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-2xl bg-dark-900 border border-white/10 shadow-2xl p-5"
      >
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-base font-semibold text-dark-100">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full hover:bg-white/10 flex items-center justify-center"
            aria-label="Close"
          >
            <X className="w-4 h-4 text-dark-300" />
          </button>
        </div>

        {kind === "suspend" && (
          <div className="mb-3">
            <label className="block text-xs font-medium text-dark-300 mb-1">
              Suspended until (optional)
            </label>
            <input
              type="datetime-local"
              value={until}
              onChange={(e) => setUntil(e.target.value)}
              className="w-full h-10 rounded-lg bg-white/5 border border-white/10 px-3 text-sm text-dark-100 focus:outline-none focus:border-primary-500/40"
            />
            <p className="text-[10px] text-dark-500 mt-1">
              Leave blank for indefinite suspension (lift manually).
            </p>
          </div>
        )}

        <div className="mb-3">
          <label className="block text-xs font-medium text-dark-300 mb-1">
            {kind === "dismiss"
              ? "Admin note (optional)"
              : "Reason / admin note"}
          </label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            maxLength={2000}
            placeholder={
              kind === "dismiss"
                ? "Why you're closing this report. Optional."
                : kind === "revoke-vip" || kind === "revoke-mvp"
                  ? "Why you're revoking this role."
                  : "Reason shown to the user + saved with the report."
            }
            className="w-full resize-none rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm text-dark-100 placeholder-dark-500 focus:outline-none focus:border-primary-500/40"
          />
          <p className="text-[10px] text-dark-500 text-right mt-1 tabular-nums">
            {notes.length} / 2000
          </p>
        </div>

        {err && (
          <p className="text-xs text-red-300 mb-2">{err}</p>
        )}

        <div className="flex gap-2 justify-end">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="px-4 h-10 rounded-lg bg-white/5 hover:bg-white/10 text-dark-200 text-sm font-medium disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={submitting}
            className={`px-4 h-10 rounded-lg text-white text-sm font-medium disabled:opacity-50 ${
              kind === "dismiss"
                ? "bg-primary-600"
                : kind === "suspend"
                  ? "bg-amber-600"
                  : kind === "ban"
                    ? "bg-red-600"
                    : "bg-primary-600"
            }`}
          >
            {submitting
              ? "Working…"
              : kind === "dismiss"
                ? "Dismiss"
                : kind === "suspend"
                  ? "Suspend"
                  : kind === "ban"
                    ? "Ban"
                    : kind === "revoke-mvp"
                      ? "Revoke MVP"
                      : "Revoke VIP"}
          </button>
        </div>
      </div>
    </div>
  );
}
