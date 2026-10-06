"use client";

import { useState } from "react";
import { Check, Copy, Download, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { authFetchJson } from "@/lib/authFetch";
import { useToast } from "@/context/ToastContext";

/**
 * The password gate, the one-time display, and the save gate for recovery
 * codes. Shared by the Settings row and the mandatory step in the welcome
 * flow, deliberately: the "shown exactly once" guarantee is the whole
 * security property, and two copies of that logic is how one of them
 * quietly loses it.
 *
 * Two rules drive the component:
 *
 * 1. The codes are shown EXACTLY once. They are stored hashed, so this is
 *    not a policy that could be relaxed later; the server cannot produce
 *    them again. So Done stays disabled until the user has copied or
 *    downloaded, and the caller cannot dismiss past unsaved codes.
 *
 * 2. Generating asks for the password even though the user is signed in.
 *    Otherwise anyone holding an unlocked phone could mint a set,
 *    photograph it, and keep a way in that survives the owner changing
 *    their password.
 *
 * `onCancel` is what makes the step optional. Omit it and there is no way
 * out of the form, which is exactly what the welcome flow wants.
 */
export function RecoveryCodesForm({
  hasExisting,
  onDone,
  onCancel,
  onGenerated,
  introText,
}: {
  hasExisting: boolean;
  onDone: () => void;
  onCancel?: () => void;
  /**
   * Fired once the codes are on screen and not yet saved. Lets the parent
   * block its own dismiss affordances (backdrop tap, close button) for the
   * one moment the codes are readable and unrecoverable.
   */
  onGenerated?: () => void;
  introText?: string;
}) {
  const toast = useToast();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [saved, setSaved] = useState(false);

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
      onGenerated?.();
    } catch {
      setError("Connection error. Try again.");
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

  if (!codes) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-dark-400 leading-relaxed">
          {introText ||
            "Twenty single-use codes. If you ever lose your password and cannot reach your contacts, one of these gets you back in."}
          {hasExisting && " Generating a new set cancels your old codes."}
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
          {onCancel && (
            <Button variant="secondary" size="sm" onClick={onCancel}>
              Cancel
            </Button>
          )}
          <Button size="sm" onClick={generate} disabled={busy || !password.trim()}>
            {busy ? "Checking..." : hasExisting ? "Regenerate" : "Generate codes"}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2.5 p-3 rounded-xl bg-amber-500/10 border border-amber-500/25">
        <ShieldAlert className="w-5 h-5 text-amber-300 shrink-0 mt-0.5" />
        <div className="text-sm">
          <p className="font-semibold text-amber-200">Save these now</p>
          <p className="text-dark-300 mt-0.5 leading-relaxed">
            We cannot show them to you again. Put them in your password
            manager or write them down. Avoid a screenshot: it sits in the
            same phone someone could take.
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
        onClick={onDone}
        disabled={!saved}
        leftIcon={saved ? <Check className="w-4 h-4" /> : undefined}
      >
        {saved ? "Done" : "Copy or download first"}
      </Button>
    </div>
  );
}
