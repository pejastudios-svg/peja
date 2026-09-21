"use client";

import { useState } from "react";
import { KeyRound, ShieldAlert } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { PejaSpinner } from "@/components/ui/PejaSpinner";
import { cachePin, setPin } from "@/lib/elections";

// The action PIN gate. First use: create a 6 digit PIN (entered twice).
// After that: enter it once and it rides in memory for 10 minutes of
// actions, never touching the device's storage.
//
// Verification is deliberately NOT done here: the PIN is proven against
// the server by the action that follows, so this modal cannot be used as
// a guessing oracle.

export function ElectionPinGate({
  isOpen,
  onClose,
  onReady,
  pinSet,
}: {
  isOpen: boolean;
  onClose: () => void;
  /** Called with the PIN once it is captured (and, if new, registered). */
  onReady: (pin: string) => void;
  /** Whether the account already has a PIN. */
  pinSet: boolean;
}) {
  const [pin, setPinInput] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError("");
    if (!/^\d{6}$/.test(pin)) {
      setError("The PIN is 6 digits.");
      return;
    }
    if (!pinSet) {
      if (confirm !== pin) {
        setError("The two entries do not match.");
        return;
      }
      setBusy(true);
      try {
        await setPin(pin);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not set the PIN");
        setBusy(false);
        return;
      }
      setBusy(false);
    }
    cachePin(pin);
    const captured = pin;
    setPinInput("");
    setConfirm("");
    onReady(captured);
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={pinSet ? "Election PIN" : "Create your election PIN"}>
      <div className="space-y-4">
        <div className="flex items-start gap-3 p-3 rounded-xl bg-[var(--soft-surface)] border border-[var(--hairline)]">
          {pinSet ? (
            <KeyRound className="beacon-accent-text w-5 h-5 shrink-0 mt-0.5" />
          ) : (
            <ShieldAlert className="beacon-wait-text w-5 h-5 shrink-0 mt-0.5" />
          )}
          <p className="text-xs text-dark-400 leading-relaxed">
            {pinSet
              ? "Enter your 6 digit election PIN. It stays active for 10 minutes of actions, then you enter it again."
              : "Election actions are protected by a PIN only you know, so a stolen phone cannot upload or tally results in your name. Memorize it: there is no reset in the app, only through the admin. 5 wrong attempts lock your election access."}
          </p>
        </div>

        <input
          inputMode="numeric"
          autoFocus
          maxLength={6}
          value={pin}
          onChange={(e) => {
            setPinInput(e.target.value.replace(/\D/g, "").slice(0, 6));
            setError("");
          }}
          placeholder="000000"
          className="w-full bg-[var(--glass-input-bg)] border border-[var(--glass-border)] rounded-2xl px-4 py-4 text-center text-2xl tracking-[0.4em] text-dark-100 placeholder:text-dark-600 focus:outline-none focus:border-primary-500 transition-colors"
        />

        {!pinSet && (
          <input
            inputMode="numeric"
            maxLength={6}
            value={confirm}
            onChange={(e) => {
              setConfirm(e.target.value.replace(/\D/g, "").slice(0, 6));
              setError("");
            }}
            placeholder="Enter it again"
            className="w-full bg-[var(--glass-input-bg)] border border-[var(--glass-border)] rounded-2xl px-4 py-3.5 text-center text-lg tracking-[0.3em] text-dark-100 placeholder:text-dark-600 focus:outline-none focus:border-primary-500 transition-colors"
          />
        )}

        {error && <p className="beacon-bad-text text-sm text-center">{error}</p>}

        <button
          onClick={submit}
          disabled={busy || pin.length < 6 || (!pinSet && confirm.length < 6)}
          className="w-full py-3.5 rounded-2xl bg-primary-600 text-white font-semibold active:scale-[0.97] transition-transform disabled:opacity-40 flex items-center justify-center gap-2"
        >
          {busy ? <PejaSpinner className="w-4 h-4" /> : null}
          {pinSet ? "Continue" : "Set PIN and continue"}
        </button>
      </div>
    </Modal>
  );
}
