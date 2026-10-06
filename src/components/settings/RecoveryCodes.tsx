"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Copy, Download, KeyRound, ShieldAlert } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { authFetchJson } from "@/lib/authFetch";
import { useToast } from "@/context/ToastContext";

/**
 * Recovery codes: twenty single-use codes that get you back in when the
 * password is gone and your contacts cannot be reached.
 *
 * Two rules drive this whole component:
 *
 * 1. The codes are shown EXACTLY once. They are stored hashed, so this is
 *    not a policy we could quietly relax later; the server cannot produce
 *    them again. The UI has to make that unmistakable before the user
 *    closes the sheet, which is why dismissing is blocked until they have
 *    copied or downloaded.
 *
 * 2. Generating asks for the password even though the user is signed in.
 *    Otherwise anyone holding an unlocked phone could mint a set,
 *    photograph it, and keep a way in that survives the owner changing
 *    their password.
 */
export function RecoveryCodes() {
  const toast = useToast();
  const [status, setStatus] = useState<{ hasCodes: boolean; unused: number; total: number } | null>(null);
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    try {
      const { res, data } = await authFetchJson("/api/recovery/codes");
      if (res.ok && data) {
        setStatus({ hasCodes: data.hasCodes, unused: data.unused, total: data.total });
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
    if (codes && !saved) return;
    setOpen(false);
    setPassword("");
    setCodes(null);
    setSaved(false);
    setError(null);
    load();
  };

  const generate = async () => {
    if (!password.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const { res, data } = await authFetchJson("/api/recovery/codes", {
        method: "POST",
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        setError(data?.error || "Could not create codes");
        return;
      }
      setCodes(data.codes as string[]);
      setPassword("");
    } finally {
      setBusy(false);
    }
  };

  const copyAll = async () => {
    if (!codes) return;
    try {
      await navigator.clipboard.writeText(codes.join("\n"));
      setSaved(true);
      toast.success("Codes copied");
    } catch {
      setError("Could not copy. Use Download instead, or write them down.");
    }
  };

  const download = () => {
    if (!codes) return;
    const body =
      "PEJA RECOVERY CODES\n" +
      "Each code works once. Keep this file somewhere safe.\n\n" +
      codes.join("\n") +
      "\n";
    const blob = new Blob([body], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "peja-recovery-codes.txt";
    a.click();
    URL.revokeObjectURL(url);
    setSaved(true);
  };

  const subtitle = !status
    ? "Loading..."
    : status.hasCodes
      ? `${status.unused} of ${status.total} unused`
      : "Not set up yet";

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
        {status && !status.hasCodes && (
          <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300">
            Set up
          </span>
        )}
      </button>

      <Modal isOpen={open} onClose={close} title="Recovery codes">
        {!codes ? (
          <div className="space-y-4">
            <p className="text-sm text-dark-400 leading-relaxed">
              Twenty single-use codes. If you ever lose your password and cannot
              reach your contacts, one of these gets you back in.
              {status?.hasCodes && " Generating a new set cancels your old codes."}
            </p>
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") generate();
              }}
              placeholder="Your current password"
              className="w-full px-3 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white text-sm outline-none focus:border-primary-500/50 placeholder:text-dark-500"
            />
            <p className="text-xs text-dark-500">
              We ask for your password so that someone holding your unlocked
              phone cannot create codes behind your back.
            </p>
            {error && <p className="text-sm text-red-400">{error}</p>}
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" onClick={close}>
                Cancel
              </Button>
              <Button size="sm" onClick={generate} disabled={busy || !password.trim()}>
                {busy ? "Checking..." : status?.hasCodes ? "Regenerate" : "Generate codes"}
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex gap-2.5 p-3 rounded-xl bg-amber-500/10 border border-amber-500/25">
              <ShieldAlert className="w-5 h-5 text-amber-300 shrink-0 mt-0.5" />
              <div className="text-sm">
                <p className="font-semibold text-amber-200">Save these now</p>
                <p className="text-dark-300 mt-0.5 leading-relaxed">
                  We cannot show them to you again. Put them in your password
                  manager, your notes, or print them.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 p-3 rounded-xl bg-white/5 border border-white/10 font-mono text-sm text-dark-100">
              {codes.map((c) => (
                <span key={c}>{c}</span>
              ))}
            </div>

            <div className="flex gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={copyAll}
                leftIcon={<Copy className="w-4 h-4" />}
              >
                Copy all
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={download}
                leftIcon={<Download className="w-4 h-4" />}
              >
                Download
              </Button>
            </div>

            {error && <p className="text-sm text-red-400">{error}</p>}

            <Button
              size="sm"
              onClick={close}
              disabled={!saved}
              leftIcon={saved ? <Check className="w-4 h-4" /> : undefined}
            >
              {saved ? "Done" : "Copy or download first"}
            </Button>
          </div>
        )}
      </Modal>
    </>
  );
}
