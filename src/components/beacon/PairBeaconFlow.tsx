"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/context/ToastContext";
import { authFetchJson } from "@/lib/authFetch";
import { AvatarImage } from "@/components/ui/AvatarImage";
import { BeaconScanner } from "./BeaconScanner";
import { BeaconSuccess } from "./BeaconSuccess";
import {
  ArrowLeft, Check, ChevronRight, Copy, MessageCircle, Phone, Radio, Send,
} from "lucide-react";
import type { BeaconCommand, BeaconDevice } from "@/lib/beacon";

type Step = "intro" | "scan" | "sim" | "contacts" | "configure" | "done";

interface PickableContact {
  id: string; // emergency_contacts row id
  name: string;
  avatar: string | null;
  phone: string | null;
}

export function PairBeaconFlow({ onPaired }: { onPaired: (device: BeaconDevice) => void }) {
  const { user } = useAuth();
  const toast = useToast();

  const [step, setStep] = useState<Step>("intro");
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [sim, setSim] = useState("");
  const [contacts, setContacts] = useState<PickableContact[]>([]);
  const [family1, setFamily1] = useState<string | null>(null);
  const [family2, setFamily2] = useState<string | null>(null);
  const [pairing, setPairing] = useState(false);
  const [pairedDevice, setPairedDevice] = useState<BeaconDevice | null>(null);
  const [commands, setCommands] = useState<BeaconCommand[]>([]);
  const [sentCmds, setSentCmds] = useState<Set<number>>(new Set());
  const [connected, setConnected] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Load accepted emergency contacts (with phone numbers) for the pickers.
  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data } = await supabase
        .from("emergency_contacts")
        .select("id, contact_user_id, status")
        .eq("user_id", user.id)
        .eq("status", "accepted");
      const rows = (data || []).filter((c) => c.contact_user_id);
      if (rows.length === 0) return;
      const { data: users } = await supabase
        .from("users")
        .select("id, full_name, avatar_url, phone")
        .in("id", rows.map((r) => r.contact_user_id as string));
      const byId = new Map((users || []).map((u) => [u.id, u]));
      const picked: PickableContact[] = rows.map((r) => {
        const u = byId.get(r.contact_user_id as string);
        return {
          id: r.id,
          name: u?.full_name || "Unknown",
          avatar: u?.avatar_url || null,
          phone: u?.phone || null,
        };
      });
      setContacts(picked);
      // Defaults: first two contacts WITH phone numbers, in list order.
      const eligible = picked.filter((c) => c.phone);
      setFamily1((prev) => prev ?? eligible[0]?.id ?? null);
      setFamily2((prev) => prev ?? eligible[1]?.id ?? null);
    })();
  }, [user]);

  // While configuring, watch for the gateway flipping us to connected.
  useEffect(() => {
    if (step !== "configure" || !pairedDevice || connected) return;
    pollRef.current = setInterval(async () => {
      const { data } = await supabase
        .from("devices")
        .select("status")
        .eq("id", pairedDevice.id)
        .maybeSingle();
      if (data?.status === "connected") {
        setConnected(true);
        if (navigator.vibrate) navigator.vibrate([15, 70, 30]);
        setStep("done");
      }
    }, 2500);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [step, pairedDevice, connected]);

  const validSim = /^(\+?234|0)\d{10}$/.test(sim.replace(/[^\d+]/g, ""));

  const startPairing = useCallback(async () => {
    if (!deviceId || pairing) return;
    setPairing(true);
    try {
      const { res, data } = await authFetchJson("/api/beacon/pair", {
        method: "POST",
        body: JSON.stringify({
          device_id: deviceId,
          sim_msisdn: sim,
          family1_contact_id: family1,
          family2_contact_id: family2,
        }),
      });
      if (!res.ok) {
        toast.warning(data?.error || "Pairing failed. Try again.");
        return;
      }
      setPairedDevice(data.device);
      setCommands(data.commands || []);
      setStep("configure");
    } catch {
      toast.warning("Network error. Check your connection and try again.");
    } finally {
      setPairing(false);
    }
  }, [deviceId, sim, family1, family2, pairing, toast]);

  const simDigits = sim.replace(/[^\d+]/g, "");
  const markSent = (i: number) => setSentCmds((prev) => new Set(prev).add(i));

  const back = () => {
    if (step === "scan") setStep("intro");
    else if (step === "sim") setStep("scan");
    else if (step === "contacts") setStep("sim");
  };

  const progress = useMemo(() => {
    const visible: Step[] = ["scan", "sim", "contacts", "configure"];
    const i = visible.indexOf(step);
    return i === -1 ? (step === "done" ? 1 : 0) : (i + 1) / (visible.length + 1);
  }, [step]);

  return (
    <div className="max-w-md mx-auto px-5 pb-28">
      {/* progress hairline */}
      {step !== "intro" && step !== "done" && (
        <div className="flex items-center gap-3 pt-2 pb-6">
          <button
            onClick={back}
            disabled={step === "configure"}
            className="w-9 h-9 rounded-full bg-dark-800 flex items-center justify-center active:scale-90 transition-transform disabled:opacity-0"
            aria-label="Back"
          >
            <ArrowLeft className="w-4.5 h-4.5 text-dark-300" />
          </button>
          <div className="flex-1 h-1 rounded-full bg-dark-800 overflow-hidden">
            <div
              className="h-full rounded-full bg-primary-500"
              style={{ width: `${progress * 100}%`, transition: "width 0.6s cubic-bezier(0.32, 0.72, 0, 1)" }}
            />
          </div>
          <div className="w-9" />
        </div>
      )}

      {step === "intro" && (
        <div className="pt-10 text-center space-y-8">
          <div className="beacon-stagger relative mx-auto w-40 h-40" style={{ animationDelay: "0.05s" }}>
            <div className="absolute inset-0 rounded-full bg-primary-500/10 beacon-radar-ring" />
            <div className="absolute inset-0 rounded-full bg-primary-500/10 beacon-radar-ring" style={{ animationDelay: "0.8s" }} />
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="w-24 h-24 rounded-[28px] bg-gradient-to-b from-dark-700 to-dark-800 border border-dark-600 shadow-2xl flex items-center justify-center beacon-breathe">
                <Radio className="w-10 h-10 beacon-accent-text" />
              </div>
            </div>
          </div>
          <div className="space-y-2">
            <h1 className="beacon-stagger text-2xl font-bold text-dark-50" style={{ animationDelay: "0.15s" }}>
              Beacon 1
            </h1>
            <p className="beacon-stagger text-dark-400 text-[15px] leading-relaxed px-4" style={{ animationDelay: "0.22s" }}>
              A discreet tracker with a real SOS button. Pair it once and it
              quietly watches over you: no phone needed.
            </p>
          </div>
          <div className="beacon-stagger space-y-3 text-left px-2" style={{ animationDelay: "0.3s" }}>
            {[
              "SOS button alerts your contacts and people nearby",
              "Two call buttons dial your chosen contacts",
              "Live location on the peja map",
            ].map((line, i) => (
              <div key={i} className="flex items-center gap-3">
                <div className="w-6 h-6 rounded-full bg-primary-500/15 flex items-center justify-center shrink-0">
                  <Check className="w-3.5 h-3.5 beacon-accent-text" />
                </div>
                <p className="text-sm text-dark-300">{line}</p>
              </div>
            ))}
          </div>
          <button
            onClick={() => setStep("scan")}
            className="beacon-stagger w-full py-4 rounded-2xl bg-primary-600 text-white font-semibold text-[15px] shadow-lg shadow-primary-900/40 active:scale-[0.98] transition-transform"
            style={{ animationDelay: "0.38s" }}
          >
            Pair your Beacon
          </button>
        </div>
      )}

      {step === "scan" && (
        <div className="pt-4">
          <h2 className="beacon-step-in text-xl font-bold text-dark-50 text-center mb-6">Scan your Beacon</h2>
          <BeaconScanner
            onFound={(id) => {
              setDeviceId(id);
              setStep("sim");
            }}
          />
        </div>
      )}

      {step === "sim" && (
        <div className="pt-4 beacon-step-in space-y-6">
          <div className="text-center space-y-2">
            <div className="mx-auto w-12 h-12 rounded-2xl bg-green-500/15 flex items-center justify-center">
              <Check className="w-6 h-6 beacon-ok-text" />
            </div>
            <h2 className="text-xl font-bold text-dark-50">Beacon found</h2>
            <p className="text-sm text-dark-400">
              ID <span className="text-dark-200 font-mono">{deviceId}</span>
            </p>
          </div>
          <div className="space-y-3">
            <label className="block text-sm font-medium text-dark-300">
              Phone number of the SIM inside the Beacon
            </label>
            <input
              inputMode="tel"
              autoFocus
              value={sim}
              onChange={(e) => setSim(e.target.value)}
              placeholder="0801 234 5678"
              className="w-full bg-dark-800 border border-dark-600 rounded-2xl px-4 py-3.5 text-center text-lg tracking-wider text-dark-100 placeholder:text-dark-500 focus:outline-none focus:border-primary-500 transition-colors"
            />
            <p className="text-xs text-dark-500 leading-relaxed">
              The Beacon is set up by text message, so its SIM needs airtime
              and data. This number stays private.
            </p>
          </div>
          <button
            onClick={() => setStep("contacts")}
            disabled={!validSim}
            className="w-full py-4 rounded-2xl bg-primary-600 text-white font-semibold active:scale-[0.98] transition-all disabled:opacity-40"
          >
            Continue
          </button>
        </div>
      )}

      {step === "contacts" && (
        <div className="pt-4 beacon-step-in space-y-5">
          <div className="text-center space-y-1.5">
            <h2 className="text-xl font-bold text-dark-50">Who should it call?</h2>
            <p className="text-sm text-dark-400 px-2">
              The two buttons on the front each call one person. Holding SOS
              calls contact 1 and alerts everyone.
            </p>
          </div>

          {contacts.length === 0 ? (
            <div className="text-center py-8 space-y-3">
              <p className="text-dark-400 text-sm">
                You have no accepted emergency contacts yet. You can pair now
                and add them later, but the call buttons won&apos;t work until you do.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {([["Button 1 + SOS", family1, setFamily1, family2],
                 ["Button 2", family2, setFamily2, family1]] as const).map(
                ([label, value, setter, otherValue], slot) => (
                <div key={label} className="space-y-2">
                  <p className="text-xs font-bold uppercase tracking-wider text-dark-500 flex items-center gap-1.5">
                    <Phone className="w-3 h-3" /> {label}
                  </p>
                  <div className="space-y-1.5">
                    {contacts.map((c) => {
                      const disabled = !c.phone || c.id === otherValue;
                      const selected = value === c.id;
                      return (
                        <button
                          key={c.id}
                          disabled={disabled}
                          onClick={() => setter(selected && slot === 1 ? null : c.id)}
                          className={`w-full flex items-center gap-3 p-3 rounded-2xl border transition-all active:scale-[0.985] ${
                            selected
                              ? "border-primary-500 bg-primary-500/10"
                              : "border-dark-700 bg-dark-800/60"
                          } ${disabled ? "opacity-35" : ""}`}
                        >
                          <AvatarImage
                            src={c.avatar}
                            alt={c.name}
                            wrapperClassName="w-9 h-9 rounded-full overflow-hidden bg-dark-700 shrink-0"
                          />
                          <div className="flex-1 text-left min-w-0">
                            <p className="text-sm font-medium text-dark-100 truncate">{c.name}</p>
                            <p className="text-xs text-dark-500">
                              {c.phone || "No phone number on profile"}
                            </p>
                          </div>
                          <div
                            className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all ${
                              selected ? "border-primary-400 bg-primary-500" : "border-dark-600"
                            }`}
                          >
                            {selected && <Check className="w-3 h-3 text-white" />}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}

          <button
            onClick={startPairing}
            disabled={pairing}
            className="w-full py-4 rounded-2xl bg-primary-600 text-white font-semibold active:scale-[0.98] transition-all disabled:opacity-60 flex items-center justify-center gap-2"
          >
            {pairing ? "Setting up..." : "Set up my Beacon"}
            {!pairing && <ChevronRight className="w-4 h-4" />}
          </button>
        </div>
      )}

      {step === "configure" && pairedDevice && (
        <div className="pt-2 beacon-step-in space-y-6">
          <div className="relative mx-auto w-36 h-36">
            <div className="absolute inset-0 rounded-full bg-primary-500/10 beacon-radar-ring" />
            <div className="absolute inset-0 rounded-full bg-primary-500/10 beacon-radar-ring" style={{ animationDelay: "0.8s" }} />
            <div className="absolute inset-0 rounded-full bg-primary-500/10 beacon-radar-ring" style={{ animationDelay: "1.6s" }} />
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="w-20 h-20 rounded-3xl bg-gradient-to-b from-dark-700 to-dark-800 border border-dark-600 flex items-center justify-center beacon-breathe">
                <Radio className="w-8 h-8 beacon-accent-text" />
              </div>
            </div>
          </div>
          <div className="text-center space-y-1.5">
            <h2 className="text-xl font-bold text-dark-50">Waiting for your Beacon</h2>
            <p className="text-sm text-dark-400 px-4">
              Text these commands to the Beacon&apos;s SIM, in order, about 10
              seconds apart. It will connect on its own after the restart.
            </p>
          </div>

          <div className="space-y-2">
            {commands.map((cmd, i) => {
              const sent = sentCmds.has(i);
              return (
                <div
                  key={i}
                  className={`beacon-stagger rounded-2xl border p-3.5 transition-colors ${
                    sent ? "border-green-500/30 bg-green-500/5" : "border-dark-700 bg-dark-800/60"
                  }`}
                  style={{ animationDelay: `${0.08 * i + 0.1}s` }}
                >
                  <div className="flex items-center gap-2 mb-1.5">
                    <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 ${
                      sent ? "bg-green-500 text-white" : "bg-dark-700 text-dark-300"
                    }`}>
                      {sent ? <Check className="w-3 h-3" /> : i + 1}
                    </div>
                    <p className="text-xs text-dark-400 flex-1">{cmd.label}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 text-[13px] text-dark-100 font-mono bg-dark-900/70 rounded-lg px-2.5 py-2 overflow-x-auto whitespace-nowrap">
                      {cmd.sms}
                    </code>
                    <button
                      onClick={() => {
                        navigator.clipboard?.writeText(cmd.sms);
                        markSent(i);
                        toast.success("Copied");
                      }}
                      className="w-9 h-9 rounded-xl bg-dark-700 flex items-center justify-center active:scale-90 transition-transform shrink-0"
                      aria-label="Copy command"
                    >
                      <Copy className="w-4 h-4 text-dark-300" />
                    </button>
                    <a
                      href={`sms:${simDigits}?body=${encodeURIComponent(cmd.sms)}`}
                      onClick={() => markSent(i)}
                      className="w-9 h-9 rounded-xl bg-primary-600 flex items-center justify-center active:scale-90 transition-transform shrink-0"
                      aria-label="Send as SMS"
                    >
                      <Send className="w-4 h-4 text-white" />
                    </a>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex items-center justify-center gap-2 text-dark-500 text-xs">
            <MessageCircle className="w-3.5 h-3.5" />
            <span>Listening for the Beacon... this can take a couple of minutes</span>
          </div>
        </div>
      )}

      {step === "done" && pairedDevice && (
        <BeaconSuccess
          deviceName={pairedDevice.name || "Beacon 1"}
          onContinue={() => onPaired({ ...pairedDevice, status: "connected" })}
        />
      )}
    </div>
  );
}
