"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Megaphone } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { useAuth } from "@/context/AuthContext";
import { authFetchJson } from "@/lib/authFetch";

/**
 * Shows the one broadcast this user has not dismissed yet.
 *
 * Deliberately late and deliberately single. It waits for the app to
 * settle, defers to the welcome flow and to a forced password change, and
 * never stacks: whatever else is already demanding attention matters more
 * than an announcement.
 *
 * Dismissal is recorded server side rather than in localStorage, because a
 * popup people see again on every device is a popup people learn to close
 * without reading.
 */
const DELAY_MS = 5000;
const WELCOME_SEEN_KEY = "peja-welcome-v2-seen";

type Broadcast = {
  id: string;
  title: string;
  body: string;
  resourceText: string | null;
  actionUrl: string | null;
};

export function BroadcastPopup() {
  const { user } = useAuth();
  const router = useRouter();
  const [broadcast, setBroadcast] = useState<Broadcast | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!user) return;
    // A forced password change outranks everything. Let that finish first.
    if (user.must_change_password) return;
    let cancelled = false;

    const check = async () => {
      try {
        // The welcome flow ends in a mandatory step of its own. Landing a
        // second card on top of it would bury both.
        if (localStorage.getItem(WELCOME_SEEN_KEY) !== "true") return;
      } catch {
        /* storage blocked: carry on */
      }
      try {
        const { res, data } = await authFetchJson("/api/broadcasts/active");
        if (!cancelled && res.ok && data?.broadcast) setBroadcast(data.broadcast);
      } catch {
        /* offline: nothing to show */
      }
    };

    const t = setTimeout(check, DELAY_MS);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [user]);

  const dismiss = async (then?: () => void) => {
    if (!broadcast || busy) return;
    setBusy(true);
    try {
      await authFetchJson("/api/broadcasts/active", {
        method: "POST",
        body: JSON.stringify({ broadcastId: broadcast.id }),
      });
    } catch {
      /* recorded on the next open if this failed */
    } finally {
      setBusy(false);
      setBroadcast(null);
      then?.();
    }
  };

  if (!broadcast) return null;

  return (
    <Modal isOpen onClose={() => dismiss()} title={broadcast.title}>
      <div className="space-y-4">
        <div className="mx-auto w-12 h-12 rounded-2xl bg-primary-500/15 flex items-center justify-center">
          <Megaphone className="w-6 h-6 text-primary-400" />
        </div>

        <p className="text-sm text-dark-300 leading-relaxed whitespace-pre-wrap">
          {broadcast.body}
        </p>

        {broadcast.resourceText && (
          <div className="p-3 rounded-xl bg-primary-500/10 border border-primary-500/25">
            <p className="text-sm text-dark-200 leading-relaxed whitespace-pre-wrap">
              {broadcast.resourceText}
            </p>
          </div>
        )}

        <div className="flex flex-col gap-2">
          {broadcast.actionUrl && (
            <Button
              size="sm"
              disabled={busy}
              onClick={() => {
                const url = broadcast.actionUrl as string;
                dismiss(() => {
                  if (url.startsWith("http")) window.open(url, "_blank", "noopener");
                  else router.push(url);
                });
              }}
            >
              Open
            </Button>
          )}
          <button
            onClick={() => dismiss()}
            disabled={busy}
            className="w-full py-2.5 text-sm font-medium text-dark-400 hover:text-dark-200 transition-ui"
          >
            {broadcast.actionUrl ? "Not now" : "Got it"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
