"use client";

import { useState } from "react";
import { KeyRound, ShieldAlert } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { useAuth } from "@/context/AuthContext";
import { authFetchJson } from "@/lib/authFetch";
import { PasswordStrength, isPasswordStrong } from "@/components/ui/PasswordStrength";

/**
 * Blocks the app until someone holding an admin-issued temporary password
 * replaces it with their own.
 *
 * There is no dismiss and no backdrop close. The whole point of a
 * temporary password is that it stops being usable, and it only stops if
 * the user is made to change it. Left optional it would sit in their inbox
 * in plaintext as their real password, which is worse than where they
 * started.
 *
 * Shown before anything else the app might interrupt with, because every
 * other prompt is noise next to "your account is open with a password a
 * support agent emailed you".
 */
export function ForcedPasswordChange() {
  const { user, refreshUser } = useAuth();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!user?.must_change_password) return null;

  const submit = async () => {
    setError(null);
    if (!currentPassword.trim()) {
      setError("Enter the temporary password we sent you");
      return;
    }
    if (!isPasswordStrong(newPassword)) {
      setError("Password doesn't meet the requirements");
      return;
    }
    if (newPassword !== confirm) {
      setError("Passwords don't match");
      return;
    }
    setBusy(true);
    try {
      const { res, data } = await authFetchJson("/api/auth/complete-forced-change", {
        method: "POST",
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      if (!res.ok) {
        setError(data?.error || "Could not set the password");
        return;
      }
      // Clears must_change_password in the in-memory user, which is what
      // takes this modal down.
      await refreshUser();
    } catch {
      setError("Connection error. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const field =
    "w-full px-3 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white text-sm outline-none focus:border-primary-500/50 placeholder:text-dark-500";

  return (
    <Modal isOpen onClose={() => {}} title="Choose a new password">
      <div className="space-y-4">
        <div className="flex gap-2.5 p-3 rounded-xl bg-amber-500/10 border border-amber-500/25">
          <ShieldAlert className="w-5 h-5 text-amber-300 shrink-0 mt-0.5" />
          <div className="text-sm">
            <p className="font-semibold text-amber-200">You are using a temporary password</p>
            <p className="text-dark-300 mt-0.5 leading-relaxed">
              Support issued it so you could get back in. Pick your own now
              and the temporary one stops working.
            </p>
          </div>
        </div>

        <input
          type="password"
          autoComplete="current-password"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          placeholder="Temporary password"
          className={field}
        />
        <input
          type="password"
          autoComplete="new-password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          placeholder="New password"
          className={field}
        />
        <PasswordStrength password={newPassword} />
        <input
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          placeholder="Confirm new password"
          className={field}
        />

        {error && <p className="text-sm text-red-400">{error}</p>}

        <Button
          size="sm"
          onClick={submit}
          disabled={busy}
          leftIcon={<KeyRound className="w-4 h-4" />}
        >
          {busy ? "Saving..." : "Set my password"}
        </Button>

        <p className="text-xs text-dark-500 leading-relaxed">
          Afterwards, set up recovery codes under Settings, Security. They
          are how you get back in next time without waiting for support.
        </p>
      </div>
    </Modal>
  );
}
