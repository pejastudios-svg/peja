"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { KeyRound } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { useAuth } from "@/context/AuthContext";
import { authFetchJson } from "@/lib/authFetch";

/**
 * One-time nudge to set up recovery codes.
 *
 * Recovery codes only help the people who made some, and nobody goes
 * looking for a settings screen about a problem they have not had yet. So
 * this asks once, early, while the account still works.
 *
 * It deliberately does NOT ask once and give up forever. People dismiss
 * modals reflexively, often without reading, and the one user who most
 * needed codes would then never be asked again. So: show it, remember the
 * dismissal, and ask once more after a month if they still have none.
 *
 * Per device rather than per account, because localStorage is all we have
 * without another table. Worst case someone sees it on a second phone,
 * which is a mild annoyance rather than a bug.
 */
const DISMISSED_KEY = "peja-recovery-prompt-dismissed-at";
const REASK_AFTER_MS = 30 * 24 * 60 * 60 * 1000;
// Let the app settle before interrupting. Landing straight into a modal
// on launch reads as an error, not an invitation.
const DELAY_MS = 4000;

export function RecoveryCodesPrompt() {
  const { user } = useAuth();
  const router = useRouter();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    const check = async () => {
      try {
        const raw = localStorage.getItem(DISMISSED_KEY);
        if (raw) {
          const at = Number(raw);
          if (Number.isFinite(at) && Date.now() - at < REASK_AFTER_MS) return;
        }
      } catch {
        /* storage blocked: fall through and ask */
      }

      try {
        const { res, data } = await authFetchJson("/api/recovery/codes");
        // Only interrupt someone who genuinely has no codes. Anyone part
        // way through, or already set up, is left alone.
        if (!cancelled && res.ok && data && !data.hasCodes) setOpen(true);
      } catch {
        /* offline or erroring: never nag on a guess */
      }
    };

    const t = setTimeout(check, DELAY_MS);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [user]);

  const remember = () => {
    try {
      localStorage.setItem(DISMISSED_KEY, String(Date.now()));
    } catch {}
  };

  const dismiss = () => {
    remember();
    setOpen(false);
  };

  const go = () => {
    remember();
    setOpen(false);
    router.push("/settings");
  };

  if (!user) return null;

  return (
    <Modal isOpen={open} onClose={dismiss} title="Set up recovery codes">
      <div className="space-y-4">
        <div className="mx-auto w-12 h-12 rounded-2xl bg-primary-500/15 flex items-center justify-center">
          <KeyRound className="w-6 h-6 text-primary-400" />
        </div>
        <p className="text-sm text-dark-300 leading-relaxed text-center">
          If you ever forget your password, recovery codes are how you get back
          into Peja. They take a minute to set up and you only do it once.
        </p>
        <p className="text-xs text-dark-500 text-center">
          Without them, getting back in depends on reaching your emergency
          contacts.
        </p>
        <div className="flex flex-col gap-2 pt-1">
          <Button size="sm" onClick={go}>
            Set them up
          </Button>
          <button
            onClick={dismiss}
            className="w-full py-2 text-sm text-dark-400 hover:text-dark-200 transition-ui"
          >
            Not now
          </button>
        </div>
      </div>
    </Modal>
  );
}
