"use client";

import { useCallback, useEffect, useState } from "react";
import { ShieldQuestion } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { useAuth } from "@/context/AuthContext";
import { authFetchJson } from "@/lib/authFetch";
import { useToast } from "@/context/ToastContext";

/**
 * Asks a nominated contact whether a recovery attempt was really their
 * person, and lets an account owner kill one that was not.
 *
 * Shown as a modal rather than buried in notifications because both sides
 * are time-critical: the approver is holding up someone locked out, and
 * the owner is holding the only defence against an imposter.
 *
 * The wording leans deliberately toward refusing. An approver who is
 * unsure should say no: a wrong "no" costs the real person a few minutes
 * and a second attempt, while a wrong "yes" costs them their account.
 */
export function RecoveryApprovalPrompt() {
  const { user } = useAuth();
  const toast = useToast();
  const [pending, setPending] = useState<{ requestId: string; name: string }[]>([]);
  const [own, setOwn] = useState<{ id: string; status: string; unlock_at: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [left, setLeft] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const { res, data } = await authFetchJson("/api/recovery/respond");
      if (!res.ok || !data) return;
      setPending(data.pending || []);
      setOwn(data.ownRequest || null);
    } catch {
      /* transient: try again on the next tick */
    }
  }, []);

  useEffect(() => {
    if (!user) return;
    load();
    // Slow poll. These are rare events, so a minute is fine for catching
    // one that arrived while the app was already open.
    const t = setInterval(load, 60_000);
    // ...but a minute is far too long when someone has just deliberately
    // tapped the notification. The notifications page fires this so the
    // modal appears straight away instead of after a wait that reads as
    // the tap having done nothing.
    const onRefresh = () => load();
    window.addEventListener("peja:recovery-refresh", onRefresh);
    return () => {
      clearInterval(t);
      window.removeEventListener("peja:recovery-refresh", onRefresh);
    };
  }, [user, load]);

  // Live countdown on the owner's cancel window.
  useEffect(() => {
    if (!own?.unlock_at) {
      setLeft(null);
      return;
    }
    const tick = () => {
      const ms = Date.parse(own.unlock_at as string) - Date.now();
      setLeft(Math.max(0, Math.floor(ms / 1000)));
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [own?.unlock_at]);

  const respond = async (requestId: string, approve: boolean) => {
    setBusy(true);
    try {
      const { res, data } = await authFetchJson("/api/recovery/respond", {
        method: "POST",
        body: JSON.stringify({ requestId, approve }),
      });
      if (!res.ok) {
        // 409/403 mean this one is settled: already answered, cancelled, or
        // expired. Leaving the buttons up invites someone to keep tapping a
        // question that no longer exists, so clear it and say why.
        if (res.status === 409 || res.status === 403) {
          toast.warning("This request has already been answered.");
          setPending((p) => p.filter((x) => x.requestId !== requestId));
          return;
        }
        toast.warning(data?.error || "Could not send your answer");
        return;
      }
      toast.success(approve ? "Thank you, your approval was recorded" : "Stopped. Thank you for checking.");
      setPending((p) => p.filter((x) => x.requestId !== requestId));
    } finally {
      setBusy(false);
    }
  };

  const cancelOwn = async () => {
    if (!own) return;
    setBusy(true);
    try {
      const { res } = await authFetchJson("/api/recovery/respond", {
        method: "POST",
        body: JSON.stringify({ requestId: own.id, cancel: true }),
      });
      if (res.ok) {
        toast.success("Recovery attempt cancelled");
        setOwn(null);
      }
    } finally {
      setBusy(false);
    }
  };

  if (!user) return null;

  // The owner's own account being recovered takes priority over anything
  // they have been asked to approve for somebody else.
  if (own) {
    const mins = left != null ? Math.floor(left / 60) : null;
    const secs = left != null ? left % 60 : null;
    return (
      <Modal isOpen onClose={() => {}} title="Someone is recovering your account">
        <div className="space-y-4">
          <p className="text-sm text-dark-300 leading-relaxed">
            A recovery request was started on your account.
            {own.status === "approved"
              ? " Your contacts approved it, and access will open when the timer ends."
              : " It is waiting on your contacts to confirm."}
          </p>
          {own.status === "approved" && left != null && (
            <div className="text-center py-2">
              <p className="text-3xl font-black text-dark-50 tabular-nums">
                {String(mins).padStart(2, "0")}:{String(secs).padStart(2, "0")}
              </p>
              <p className="text-xs text-dark-500 mt-1">until access opens</p>
            </div>
          )}
          <p className="text-sm text-amber-300">
            If this was not you, cancel it now. You can still change your
            password afterwards to be sure.
          </p>
          <Button size="sm" variant="danger" onClick={cancelOwn} disabled={busy}>
            This was not me, cancel it
          </Button>
        </div>
      </Modal>
    );
  }

  const first = pending[0];
  if (!first) return null;

  return (
    <Modal
      isOpen
      // Closing only sets this one aside. It stays unanswered in their
      // notifications, which is the point of writing a row for it.
      onClose={() => setPending((p) => p.slice(1))}
      title="Recovery request"
    >
      <div className="space-y-4">
        <div className="mx-auto w-12 h-12 rounded-2xl bg-primary-500/15 flex items-center justify-center">
          <ShieldQuestion className="w-6 h-6 text-primary-400" />
        </div>
        <p className="text-center text-dark-100 font-semibold">
          {first.name} is trying to get back into their Peja account
        </p>
        <p className="text-center text-sm text-dark-400 leading-relaxed">
          They named you as someone who could confirm it is really them. Only
          approve if you are sure. If you are not certain, say no and ask them
          directly first.
        </p>
        <div className="flex flex-col gap-2">
          <Button size="sm" onClick={() => respond(first.requestId, true)} disabled={busy}>
            Yes, that is {first.name}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => respond(first.requestId, false)}
            disabled={busy}
          >
            No, I am not sure
          </Button>
        </div>
      </div>
    </Modal>
  );
}
