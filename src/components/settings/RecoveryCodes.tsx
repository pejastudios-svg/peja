"use client";

import { useCallback, useEffect, useState } from "react";
import { KeyRound } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { authFetchJson } from "@/lib/authFetch";
import { RecoveryCodesForm } from "@/components/recovery/RecoveryCodesForm";

/**
 * Settings row for recovery codes: twenty single-use codes that get you
 * back in when the password is gone and your contacts cannot be reached.
 *
 * The password gate and the one-time display live in RecoveryCodesForm,
 * which the mandatory welcome step shares. This file is only the row, the
 * status line and the modal around it.
 *
 * A Google-only account has no password, so it can neither satisfy the
 * form's re-authentication nor needs codes in the first place: those users
 * recover through Google. The row says so rather than offering a password
 * field that can never be filled.
 */
type Status = { hasCodes: boolean; unused: number; total: number; hasPassword: boolean };

export function RecoveryCodes() {
  const [status, setStatus] = useState<Status | null>(null);
  const [open, setOpen] = useState(false);
  const [dirty, setDirty] = useState(false);

  const load = useCallback(async () => {
    try {
      const { res, data } = await authFetchJson("/api/recovery/codes");
      if (res.ok && data) {
        setStatus({
          hasCodes: data.hasCodes,
          unused: data.unused,
          total: data.total,
          // Older clients and error paths should not accidentally excuse an
          // account from codes, so treat an absent flag as "has a password".
          hasPassword: data.hasPassword !== false,
        });
      }
    } catch {
      /* leave the row showing its last known state */
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const close = () => {
    // Refuse to close over unsaved codes. This is the only moment they
    // exist in readable form anywhere.
    if (dirty) return;
    setOpen(false);
    load();
  };

  const finish = () => {
    setDirty(false);
    setOpen(false);
    load();
  };

  const subtitle = !status
    ? "Loading..."
    : !status.hasPassword
      ? "Not needed for Google sign-in"
      : status.hasCodes
        ? `${status.unused} of ${status.total} unused`
        : "Not set up yet";

  const needsSetup = Boolean(status && status.hasPassword && !status.hasCodes);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="w-full flex items-center gap-3 py-3 text-left active:scale-[0.99] transition-transform"
      >
        <KeyRound className="w-5 h-5 text-dark-400 shrink-0" />
        <span className="flex-1 min-w-0">
          <span className="block text-dark-100">Recovery codes</span>
          <span className="block text-sm text-dark-400">{subtitle}</span>
        </span>
        {needsSetup && (
          <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300">
            Set up
          </span>
        )}
      </button>

      <Modal isOpen={open} onClose={close} title="Recovery codes">
        {status && !status.hasPassword ? (
          <div className="space-y-4">
            <p className="text-sm text-dark-300 leading-relaxed">
              This account signs in with Google, so there is no peja password
              to recover. If you ever lose access, reset it through your
              Google account and you will be able to sign in here again.
            </p>
            <Button size="sm" onClick={() => setOpen(false)}>
              Got it
            </Button>
          </div>
        ) : (
          <RecoveryCodesForm
            hasExisting={Boolean(status?.hasCodes)}
            onDone={finish}
            onCancel={dirty ? undefined : () => setOpen(false)}
            onGenerated={() => setDirty(true)}
          />
        )}
      </Modal>
    </>
  );
}
