"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/context/ToastContext";
import { authFetchJson } from "@/lib/authFetch";
import { Modal } from "@/components/ui/Modal";
import { formatDistanceToNow } from "date-fns";
import {
  Activity, Battery, BatteryLow, Check, ChevronRight, Copy, MapPin,
  Phone, Radio, Send, Trash2, Volume1, VolumeX,
} from "lucide-react";
import type { BeaconCommand, BeaconDevice } from "@/lib/beacon";

const STATUS_META: Record<string, { label: string; dot: string; text: string }> = {
  connected: { label: "Connected", dot: "bg-green-400 beacon-live-dot", text: "text-green-400" },
  configuring: { label: "Waiting for device", dot: "bg-amber-400 animate-pulse", text: "text-amber-400" },
  offline: { label: "Offline", dot: "bg-red-400", text: "text-red-400" },
  pairing: { label: "Pairing", dot: "bg-amber-400 animate-pulse", text: "text-amber-400" },
  unpaired: { label: "Unpaired", dot: "bg-dark-500", text: "text-dark-400" },
};

function Toggle({ on, onChange, disabled }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={`relative w-[50px] h-[30px] rounded-full transition-colors duration-300 shrink-0 ${
        on ? "bg-green-500" : "bg-dark-600"
      } ${disabled ? "opacity-50" : ""}`}
    >
      <span
        className="absolute top-[3px] w-6 h-6 rounded-full bg-white shadow-md"
        style={{
          left: on ? 23 : 3,
          transition: "left 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)",
        }}
      />
    </button>
  );
}

export function BeaconDashboard({
  device: initial,
  onUnpaired,
}: {
  device: BeaconDevice;
  onUnpaired: () => void;
}) {
  const { user } = useAuth();
  const toast = useToast();
  const [device, setDevice] = useState<BeaconDevice>(initial);
  const [contactNames, setContactNames] = useState<Map<string, string>>(new Map());
  const [pendingCommands, setPendingCommands] = useState<BeaconCommand[] | null>(null);
  const [confirmUnpair, setConfirmUnpair] = useState(false);
  const [unpairing, setUnpairing] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);

  // Keep telemetry fresh while the screen is open.
  useEffect(() => {
    const refresh = async () => {
      const { data } = await supabase
        .from("devices")
        .select("*")
        .eq("id", initial.id)
        .maybeSingle();
      if (data && data.status !== "unpaired") setDevice(data as BeaconDevice);
    };
    const t = setInterval(refresh, 10_000);
    window.addEventListener("focus", refresh);
    return () => { clearInterval(t); window.removeEventListener("focus", refresh); };
  }, [initial.id]);

  // Resolve chosen contact names for display.
  useEffect(() => {
    if (!user) return;
    const ids = [device.family1_contact_id, device.family2_contact_id].filter(Boolean) as string[];
    if (ids.length === 0) return;
    (async () => {
      const { data } = await supabase
        .from("emergency_contacts")
        .select("id, contact_user_id")
        .in("id", ids);
      const userIds = (data || []).map((c) => c.contact_user_id).filter(Boolean) as string[];
      if (!userIds.length) return;
      const { data: users } = await supabase
        .from("users").select("id, full_name").in("id", userIds);
      const nameByUser = new Map((users || []).map((u) => [u.id, u.full_name || "Unknown"]));
      const m = new Map<string, string>();
      for (const c of data || []) {
        if (c.contact_user_id) m.set(c.id, nameByUser.get(c.contact_user_id) || "Unknown");
      }
      setContactNames(m);
    })();
  }, [user, device.family1_contact_id, device.family2_contact_id]);

  const save = useCallback(
    async (patch: Record<string, unknown>, key: string) => {
      setSaving(key);
      try {
        const { res, data } = await authFetchJson("/api/beacon/settings", {
          method: "POST",
          body: JSON.stringify({ id: device.id, ...patch }),
        });
        if (!res.ok) {
          toast.warning(data?.error || "Could not save");
          return;
        }
        setDevice(data.device as BeaconDevice);
        const cmds = (data.commands || []) as BeaconCommand[];
        if (cmds.length > 0) setPendingCommands(cmds);
      } catch {
        toast.warning("Network error");
      } finally {
        setSaving(null);
      }
    },
    [device.id, toast]
  );

  const unpair = async () => {
    setUnpairing(true);
    try {
      const { res, data } = await authFetchJson("/api/beacon/unpair", {
        method: "POST",
        body: JSON.stringify({ id: device.id }),
      });
      if (!res.ok) {
        toast.warning(data?.error || "Could not unpair");
        return;
      }
      toast.success("Beacon unpaired");
      onUnpaired();
    } finally {
      setUnpairing(false);
    }
  };

  const meta = STATUS_META[device.status] || STATUS_META.offline;
  const lastSeen = device.last_seen_at
    ? formatDistanceToNow(new Date(device.last_seen_at), { addSuffix: true })
    : "never";
  const battery = device.battery_pct;
  const simDigits = device.sim_msisdn.replace(/[^\d+]/g, "");

  const rows = useMemo(
    () => [
      {
        key: "fall",
        icon: <Activity className="w-4.5 h-4.5 text-orange-300" />,
        title: "Fall alerts",
        sub: "Tell my emergency contacts if a fall is detected",
        control: (
          <Toggle
            on={device.fall_alert_enabled}
            disabled={saving === "fall"}
            onChange={(v) => save({ fall_alert_enabled: v }, "fall")}
          />
        ),
      },
      {
        key: "tone",
        icon: <Volume1 className="w-4.5 h-4.5 text-primary-300" />,
        title: "SOS received tone",
        sub: "Quiet beep on the Beacon when peja gets its SOS",
        control: (
          <Toggle
            on={device.sos_ack_tone}
            disabled={saving === "tone"}
            onChange={(v) => save({ sos_ack_tone: v }, "tone")}
          />
        ),
      },
    ],
    [device.fall_alert_enabled, device.sos_ack_tone, saving, save]
  );

  return (
    <div className="max-w-md mx-auto px-5 pb-28 space-y-5">
      {/* ── Status hero ── */}
      <div className="beacon-step-in relative overflow-hidden rounded-3xl border border-dark-700 bg-gradient-to-b from-dark-800 to-dark-900 p-6">
        <div className="flex items-center gap-4">
          <div className="relative w-16 h-16 shrink-0">
            {device.status === "connected" && (
              <div className="absolute inset-0 rounded-2xl bg-primary-500/10 beacon-radar-ring" />
            )}
            <div className="relative w-16 h-16 rounded-2xl bg-gradient-to-b from-dark-600 to-dark-800 border border-dark-600 flex items-center justify-center">
              <Radio className="w-7 h-7 text-primary-300" />
            </div>
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-lg font-bold text-dark-50 truncate">{device.name}</h1>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className={`w-2 h-2 rounded-full ${meta.dot}`} />
              <span className={`text-[13px] font-medium ${meta.text}`}>{meta.label}</span>
            </div>
            <p className="text-xs text-dark-500 mt-0.5">Active {lastSeen}</p>
          </div>
          <div className="text-right shrink-0">
            {battery != null ? (
              <div className="flex items-center gap-1">
                {battery <= 15
                  ? <BatteryLow className="w-5 h-5 text-red-400" />
                  : <Battery className="w-5 h-5 text-green-400" />}
                <span className={`text-sm font-semibold ${battery <= 15 ? "text-red-400" : "text-dark-200"}`}>
                  {battery}%
                </span>
              </div>
            ) : (
              <span className="text-xs text-dark-500">no data</span>
            )}
          </div>
        </div>

        {device.last_lat != null && device.last_lng != null && (
          <a
            href={`https://maps.google.com/?q=${device.last_lat},${device.last_lng}`}
            target="_blank"
            rel="noreferrer"
            className="mt-4 flex items-center gap-2.5 rounded-2xl bg-dark-800/80 border border-dark-700 p-3 active:scale-[0.985] transition-transform"
          >
            <div className="w-8 h-8 rounded-full bg-primary-500/15 flex items-center justify-center shrink-0">
              <MapPin className="w-4 h-4 text-primary-300" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-medium text-dark-200">Last known location</p>
              <p className="text-xs text-dark-500">
                {device.last_fix_at
                  ? formatDistanceToNow(new Date(device.last_fix_at), { addSuffix: true })
                  : ""}
              </p>
            </div>
            <ChevronRight className="w-4 h-4 text-dark-500" />
          </a>
        )}
      </div>

      {/* ── Call buttons ── */}
      <div className="beacon-stagger rounded-3xl border border-dark-700 bg-dark-800/50 overflow-hidden" style={{ animationDelay: "0.08s" }}>
        <p className="px-5 pt-4 pb-1 text-xs font-bold uppercase tracking-wider text-dark-500">
          Call buttons
        </p>
        {[
          { label: "Button 1 + SOS", id: device.family1_contact_id },
          { label: "Button 2", id: device.family2_contact_id },
        ].map((slot, i) => (
          <div key={slot.label} className={`flex items-center gap-3 px-5 py-3.5 ${i === 0 ? "border-b border-dark-700/70" : ""}`}>
            <div className="w-8 h-8 rounded-full bg-green-500/15 flex items-center justify-center shrink-0">
              <Phone className="w-4 h-4 text-green-400" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-dark-100">{slot.label}</p>
              <p className="text-xs text-dark-500 truncate">
                {slot.id ? contactNames.get(slot.id) || "..." : "Not set"}
              </p>
            </div>
          </div>
        ))}
        <p className="px-5 pb-4 pt-1 text-xs text-dark-500">
          Change these from your emergency contacts list, then re-pair or
          update in settings.
        </p>
      </div>

      {/* ── Settings ── */}
      <div className="beacon-stagger rounded-3xl border border-dark-700 bg-dark-800/50 overflow-hidden" style={{ animationDelay: "0.16s" }}>
        <p className="px-5 pt-4 pb-1 text-xs font-bold uppercase tracking-wider text-dark-500">
          Settings
        </p>
        {rows.map((row, i) => (
          <div
            key={row.key}
            className={`flex items-center gap-3 px-5 py-3.5 ${i < rows.length - 1 ? "border-b border-dark-700/70" : ""}`}
          >
            <div className="w-8 h-8 rounded-full bg-dark-700 flex items-center justify-center shrink-0">
              {row.icon}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-dark-100">{row.title}</p>
              <p className="text-xs text-dark-500 leading-snug">{row.sub}</p>
            </div>
            {row.control}
          </div>
        ))}

        {/* volume segmented control */}
        <div className="px-5 py-4 border-t border-dark-700/70">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-8 h-8 rounded-full bg-dark-700 flex items-center justify-center shrink-0">
              {device.volume === 0
                ? <VolumeX className="w-4.5 h-4.5 text-dark-300" />
                : <Volume1 className="w-4.5 h-4.5 text-dark-300" />}
            </div>
            <div className="flex-1">
              <p className="text-sm font-medium text-dark-100">Speaker volume</p>
              <p className="text-xs text-dark-500">0 is fully silent for concealment</p>
            </div>
          </div>
          <div className="relative flex rounded-2xl bg-dark-900 border border-dark-700 p-1">
            <div
              className="absolute top-1 bottom-1 rounded-xl bg-primary-600"
              style={{
                width: "calc(20% - 4px)",
                left: `calc(${device.volume * 20}% + 2px)`,
                transition: "left 0.35s cubic-bezier(0.34, 1.56, 0.64, 1)",
              }}
            />
            {[0, 1, 2, 3, 4].map((v) => (
              <button
                key={v}
                disabled={saving === "volume"}
                onClick={() => v !== device.volume && save({ volume: v }, "volume")}
                className={`relative flex-1 py-2 text-sm font-semibold transition-colors ${
                  device.volume === v ? "text-white" : "text-dark-400"
                }`}
              >
                {v}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Unpair ── */}
      <button
        onClick={() => setConfirmUnpair(true)}
        className="beacon-stagger w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl border border-red-500/25 text-red-400 text-sm font-semibold active:scale-[0.98] transition-transform"
        style={{ animationDelay: "0.24s" }}
      >
        <Trash2 className="w-4 h-4" />
        Unpair this Beacon
      </button>

      {/* ── Pending SMS commands after a hardware setting change ── */}
      <Modal
        isOpen={pendingCommands !== null}
        onClose={() => setPendingCommands(null)}
        title="Send to your Beacon"
      >
        <div className="space-y-3">
          <p className="text-sm text-dark-400">
            Text this to the Beacon&apos;s SIM to apply the change on the device:
          </p>
          {(pendingCommands || []).map((cmd, i) => (
            <div key={i} className="rounded-2xl border border-dark-700 bg-dark-800/60 p-3.5">
              <p className="text-xs text-dark-400 mb-1.5">{cmd.label}</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 text-[13px] text-dark-100 font-mono bg-dark-900/70 rounded-lg px-2.5 py-2 overflow-x-auto whitespace-nowrap">
                  {cmd.sms}
                </code>
                <button
                  onClick={() => {
                    navigator.clipboard?.writeText(cmd.sms);
                    toast.success("Copied");
                  }}
                  className="w-9 h-9 rounded-xl bg-dark-700 flex items-center justify-center active:scale-90 transition-transform shrink-0"
                  aria-label="Copy"
                >
                  <Copy className="w-4 h-4 text-dark-300" />
                </button>
                <a
                  href={`sms:${simDigits}?body=${encodeURIComponent(cmd.sms)}`}
                  className="w-9 h-9 rounded-xl bg-primary-600 flex items-center justify-center active:scale-90 transition-transform shrink-0"
                  aria-label="Send as SMS"
                >
                  <Send className="w-4 h-4 text-white" />
                </a>
              </div>
            </div>
          ))}
          <button
            onClick={() => setPendingCommands(null)}
            className="w-full py-3 rounded-2xl bg-dark-700 text-dark-200 text-sm font-semibold active:scale-[0.98] transition-transform flex items-center justify-center gap-2"
          >
            <Check className="w-4 h-4" /> Done
          </button>
        </div>
      </Modal>

      {/* ── Unpair confirm ── */}
      <Modal isOpen={confirmUnpair} onClose={() => setConfirmUnpair(false)} title="Unpair Beacon?">
        <div className="space-y-4">
          <p className="text-sm text-dark-300 leading-relaxed">
            The Beacon will stop reporting to peja and its SOS button will no
            longer alert the app. Your emergency contacts stay untouched.
          </p>
          <div className="flex gap-3">
            <button
              onClick={() => setConfirmUnpair(false)}
              className="flex-1 py-3 rounded-2xl bg-dark-700 text-dark-200 text-sm font-semibold active:scale-[0.98] transition-transform"
            >
              Keep it
            </button>
            <button
              onClick={unpair}
              disabled={unpairing}
              className="flex-1 py-3 rounded-2xl bg-red-600 text-white text-sm font-semibold active:scale-[0.98] transition-transform disabled:opacity-60"
            >
              {unpairing ? "Unpairing..." : "Unpair"}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
