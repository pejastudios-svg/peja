"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/context/AuthContext";
import { Shield, ShieldCheck, ShieldOff, Copy, Check, Loader2, AlertTriangle, Smartphone, X } from "lucide-react";
import HudShell from "@/components/dashboard/HudShell";
import HudPanel from "@/components/dashboard/HudPanel";
import { useScrollFreeze } from "@/hooks/useScrollFreeze";
import { PejaSpinner } from "@/components/ui/PejaSpinner";

export default function AdminSecurityPage() {
  const { session } = useAuth();
  const [totpEnabled, setTotpEnabled] = useState(false);
  const [backupCodesRemaining, setBackupCodesRemaining] = useState(0);
  const [loading, setLoading] = useState(true);

  // Setup flow
  const [setupPhase, setSetupPhase] = useState<"idle" | "qr" | "verify" | "backup" | "done">("idle");
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [secretKey, setSecretKey] = useState<string | null>(null);
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [verifyCode, setVerifyCode] = useState("");
  const [setupError, setSetupError] = useState("");
  const [setupLoading, setSetupLoading] = useState(false);
  const [copiedSecret, setCopiedSecret] = useState(false);
  const [copiedBackup, setCopiedBackup] = useState(false);

  // Disable flow
  const [showDisable, setShowDisable] = useState(false);
  const [disableCode, setDisableCode] = useState("");
  const [disableError, setDisableError] = useState("");
  const [disableLoading, setDisableLoading] = useState(false);
  useScrollFreeze(showDisable);

  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${session?.access_token || ""}`,
  };

  useEffect(() => {
    checkStatus();
  }, [session?.access_token]);

  const checkStatus = async () => {
    try {
      const res = await fetch("/api/admin/totp/status/", { headers });
      const data = await res.json();
      setTotpEnabled(data.enabled);
      setBackupCodesRemaining(data.backupCodesRemaining || 0);
    } catch {}
    setLoading(false);
  };

  const startSetup = async () => {
    setSetupLoading(true);
    setSetupError("");
    try {
      const res = await fetch("/api/admin/totp/setup/", { method: "POST", headers });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error);
      setQrCode(data.qrCode);
      setSecretKey(data.secret);
      setBackupCodes(data.backupCodes);
      setSetupPhase("qr");
    } catch (err: any) {
      setSetupError(err.message || "Failed to start setup");
    } finally {
      setSetupLoading(false);
    }
  };

  const confirmSetup = async () => {
    setSetupLoading(true);
    setSetupError("");
    try {
      const res = await fetch("/api/admin/totp/confirm/", {
        method: "POST",
        headers,
        body: JSON.stringify({ code: verifyCode.trim() }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error);
      setSetupPhase("backup");
    } catch (err: any) {
      setSetupError(err.message || "Verification failed");
      setVerifyCode("");
    } finally {
      setSetupLoading(false);
    }
  };

  const finishSetup = () => {
    setTotpEnabled(true);
    setBackupCodesRemaining(backupCodes.length);
    setSetupPhase("done");
    setTimeout(() => setSetupPhase("idle"), 2000);
  };

  const handleDisable = async () => {
    setDisableLoading(true);
    setDisableError("");
    try {
      const res = await fetch("/api/admin/totp/disable/", {
        method: "POST",
        headers,
        body: JSON.stringify({ code: disableCode.trim() }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error);
      setTotpEnabled(false);
      setShowDisable(false);
      setDisableCode("");
    } catch (err: any) {
      setDisableError(err.message || "Failed to disable");
      setDisableCode("");
    } finally {
      setDisableLoading(false);
    }
  };

  const copyToClipboard = async (text: string, type: "secret" | "backup") => {
    try {
      await navigator.clipboard.writeText(text);
      if (type === "secret") { setCopiedSecret(true); setTimeout(() => setCopiedSecret(false), 2000); }
      else { setCopiedBackup(true); setTimeout(() => setCopiedBackup(false), 2000); }
    } catch {}
  };

  if (loading) {
    return (
      <HudShell title="Security" subtitle="Two-factor authentication settings">
        <div className="flex justify-center py-12">
          <PejaSpinner className="w-8 h-8" />
        </div>
      </HudShell>
    );
  }

  return (
    <HudShell title="Security" subtitle="Two-factor authentication settings">
      <div className="max-w-xl mx-auto space-y-6">
        {/* Status Card */}
        <HudPanel>
          <div className="flex items-center gap-4 p-2">
            <div className={`w-14 h-14 rounded-2xl flex items-center justify-center ${
              totpEnabled ? "bg-green-500/15 border border-green-500/30" : "bg-dark-700 border border-white/10"
            }`}>
              {totpEnabled ? (
                <ShieldCheck className="w-7 h-7 text-green-400" />
              ) : (
                <Shield className="w-7 h-7 text-dark-400" />
              )}
            </div>
            <div className="flex-1">
              <h3 className="text-lg font-bold text-white">
                Two-Factor Authentication
              </h3>
              <p className="text-sm text-dark-400 mt-0.5">
                {totpEnabled
                  ? `Active. ${backupCodesRemaining} backup codes remaining.`
                  : "Not enabled. Add an extra layer of security."}
              </p>
            </div>
            {totpEnabled ? (
              <button
                onClick={() => setShowDisable(true)}
                className="px-4 py-2 rounded-xl text-sm font-medium text-red-400 border border-red-500/20 bg-red-500/10 hover:bg-red-500/20 transition-colors"
              >
                Disable
              </button>
            ) : (
              <button
                onClick={startSetup}
                disabled={setupLoading}
                className="px-4 py-2 rounded-xl text-sm font-semibold text-white bg-primary-600 hover:bg-primary-500 transition-colors flex items-center gap-2"
              >
                {setupLoading ? <PejaSpinner className="w-4 h-4" />: <Smartphone className="w-4 h-4" />}
                Enable
              </button>
            )}
          </div>
        </HudPanel>

        {/* Setup Error */}
        {setupError && setupPhase === "idle" && (
          <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-sm text-red-400">
            {setupError}
          </div>
        )}

        {/* QR Code Step */}
        {setupPhase === "qr" && (
          <HudPanel>
            <div className="p-2 space-y-4">
              <div className="text-center">
                <h3 className="text-base font-bold text-white mb-1">Scan QR Code</h3>
                <p className="text-sm text-dark-400">
                  Open Google Authenticator, Authy, or any TOTP app and scan this code.
                </p>
              </div>

              {qrCode && (
                <div className="flex justify-center">
                  <div className="p-4 bg-white rounded-2xl">
                    <img src={qrCode} alt="TOTP QR Code" className="w-48 h-48" />
                  </div>
                </div>
              )}

              {secretKey && (
                <div className="p-3 rounded-xl bg-dark-800 border border-white/10">
                  <p className="text-xs text-dark-500 mb-1">Or enter this key manually:</p>
                  <div className="flex items-center gap-2">
                    <code className="text-sm text-primary-400 font-mono flex-1 break-all">{secretKey}</code>
                    <button
                      onClick={() => copyToClipboard(secretKey, "secret")}
                      className="p-1.5 rounded-lg hover:bg-white/10 shrink-0"
                    >
                      {copiedSecret ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4 text-dark-400" />}
                    </button>
                  </div>
                </div>
              )}

              <button
                onClick={() => setSetupPhase("verify")}
                className="w-full py-3 bg-primary-600 text-white rounded-xl font-semibold hover:bg-primary-500 transition-colors"
              >
                I've Scanned It
              </button>
            </div>
          </HudPanel>
        )}

        {/* Verify Step */}
        {setupPhase === "verify" && (
          <HudPanel>
            <div className="p-2 space-y-4">
              <div className="text-center">
                <h3 className="text-base font-bold text-white mb-1">Verify Setup</h3>
                <p className="text-sm text-dark-400">
                  Enter the 6-digit code shown in your authenticator app.
                </p>
              </div>

              <input
                type="text"
                value={verifyCode}
                onChange={(e) => {
                  setVerifyCode(e.target.value.replace(/\D/g, "").slice(0, 6));
                  setSetupError("");
                }}
                placeholder="000000"
                className="w-full px-4 py-4 glass-input text-xl tracking-[0.4em] text-center font-mono"
                inputMode="numeric"
                autoComplete="one-time-code"
                autoFocus
              />

              {setupError && (
                <div className="flex items-center gap-2 text-sm text-red-400 justify-center">
                  <AlertTriangle className="w-4 h-4" />
                  <p>{setupError}</p>
                </div>
              )}

              <button
                onClick={confirmSetup}
                disabled={verifyCode.length < 6 || setupLoading}
                className="w-full py-3 bg-primary-600 text-white rounded-xl font-semibold disabled:opacity-50 hover:bg-primary-500 transition-colors flex items-center justify-center gap-2"
              >
                {setupLoading ? <PejaSpinner className="w-4 h-4" /> : null}
                Verify
              </button>

              <button
                onClick={() => { setSetupPhase("qr"); setVerifyCode(""); setSetupError(""); }}
                className="w-full text-sm text-dark-500 hover:text-dark-300 py-2"
              >
                Back to QR code
              </button>
            </div>
          </HudPanel>
        )}

        {/* Backup Codes Step */}
        {setupPhase === "backup" && (
          <HudPanel>
            <div className="p-2 space-y-4">
              <div className="text-center">
                <h3 className="text-base font-bold text-white mb-1">Save Backup Codes</h3>
                <p className="text-sm text-dark-400">
                  Save these codes somewhere safe. Each can be used once if you lose your phone.
                </p>
              </div>

              <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
                  <p className="text-xs text-red-400">
                    These codes will NOT be shown again. Save them now or you may lose access to your admin dashboard.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 p-4 bg-dark-800 rounded-xl border border-white/10">
                {backupCodes.map((code, i) => (
                  <div key={i} className="text-sm font-mono text-dark-200 py-1">
                    {i + 1}. {code}
                  </div>
                ))}
              </div>

              <button
                onClick={() => copyToClipboard(backupCodes.join("\n"), "backup")}
                className="w-full py-2 rounded-xl text-sm font-medium glass-sm text-dark-200 hover:bg-white/10 flex items-center justify-center gap-2"
              >
                {copiedBackup ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
                {copiedBackup ? "Copied!" : "Copy All Codes"}
              </button>

              <button
                onClick={finishSetup}
                className="w-full py-3 bg-green-600 text-white rounded-xl font-semibold hover:bg-green-500 transition-colors"
              >
                I've Saved My Backup Codes
              </button>
            </div>
          </HudPanel>
        )}

        {/* Done */}
        {setupPhase === "done" && (
          <HudPanel>
            <div className="p-6 text-center">
              <ShieldCheck className="w-14 h-14 text-green-400 mx-auto mb-3" />
              <h3 className="text-lg font-bold text-white">2FA Enabled!</h3>
              <p className="text-sm text-dark-400 mt-1">Your admin dashboard is now protected with two-factor authentication.</p>
            </div>
          </HudPanel>
        )}

        {/* How it works */}
        {setupPhase === "idle" && (
          <HudPanel>
            <div className="p-2">
              <h4 className="text-sm font-semibold text-dark-200 mb-3">How it works</h4>
              <div className="space-y-3 text-sm text-dark-400">
                <div className="flex gap-3">
                  <span className="w-6 h-6 rounded-full bg-primary-600/20 text-primary-400 flex items-center justify-center text-xs font-bold shrink-0">1</span>
                  <p>Enter your admin PIN (something you know)</p>
                </div>
                <div className="flex gap-3">
                  <span className="w-6 h-6 rounded-full bg-primary-600/20 text-primary-400 flex items-center justify-center text-xs font-bold shrink-0">2</span>
                  <p>Enter the 6-digit code from your authenticator app (something you have)</p>
                </div>
                <div className="flex gap-3">
                  <span className="w-6 h-6 rounded-full bg-primary-600/20 text-primary-400 flex items-center justify-center text-xs font-bold shrink-0">3</span>
                  <p>Access granted for 30 minutes. Re-verify after inactivity.</p>
                </div>
              </div>
            </div>
          </HudPanel>
        )}
      </div>

      {/* Disable Modal */}
      {showDisable && (
        <>
          <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50" onClick={() => { setShowDisable(false); setDisableCode(""); setDisableError(""); }} />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div
              className="w-full max-w-sm rounded-2xl p-6"
              style={{
                background: "rgba(18, 12, 36, 0.98)",
                border: "1px solid rgba(239, 68, 68, 0.2)",
                boxShadow: "0 25px 60px rgba(0,0,0,0.6)",
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                  <ShieldOff className="w-5 h-5 text-red-400" />
                  Disable 2FA
                </h3>
                <button onClick={() => { setShowDisable(false); setDisableCode(""); setDisableError(""); }} className="p-1.5 rounded-lg hover:bg-white/10">
                  <X className="w-5 h-5 text-dark-400" />
                </button>
              </div>

              <p className="text-sm text-dark-400 mb-4">
                Enter your current authenticator code to disable two-factor authentication.
              </p>

              <input
                type="text"
                value={disableCode}
                onChange={(e) => { setDisableCode(e.target.value.replace(/\D/g, "").slice(0, 6)); setDisableError(""); }}
                placeholder="000000"
                className="w-full px-4 py-3 glass-input text-xl tracking-[0.4em] text-center font-mono mb-4"
                inputMode="numeric"
                autoFocus
              />

              {disableError && (
                <div className="flex items-center gap-2 text-sm text-red-400 mb-4 justify-center">
                  <AlertTriangle className="w-4 h-4" />
                  <p>{disableError}</p>
                </div>
              )}

              <div className="flex gap-3">
                <button
                  onClick={() => { setShowDisable(false); setDisableCode(""); setDisableError(""); }}
                  className="flex-1 py-2.5 rounded-xl text-sm font-medium glass-sm text-dark-200 hover:bg-white/10"
                >
                  Cancel
                </button>
                <button
                  onClick={handleDisable}
                  disabled={disableCode.length < 6 || disableLoading}
                  className="flex-1 py-2.5 rounded-xl text-sm font-semibold bg-red-600 text-white disabled:opacity-40 hover:bg-red-500 transition-colors flex items-center justify-center gap-2"
                >
                  {disableLoading ? <PejaSpinner className="w-4 h-4" /> : null}
                  Disable 2FA
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </HudShell>
  );
}