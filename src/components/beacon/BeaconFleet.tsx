"use client";

import { useMemo, useState } from "react";
import { Battery, BatteryLow, FileSpreadsheet, List, Map as MapIcon, Plus, Radio, Search, ChevronRight } from "lucide-react";
import { BeaconFleetMap } from "./BeaconFleetMap";
import { BeaconBulkImport } from "./BeaconBulkImport";
import type { BeaconDevice } from "@/lib/beacon";

// The Beacon home list: every device this account hosts, one card each,
// navigated by wearer. Scales from a family's three to a school's fleet:
// search appears once the list is big enough to need it, and the cards
// stay cheap (no maps, no live subscriptions, just the row data).

function lastSeenLabel(device: BeaconDevice): string {
  const t = device.last_seen_at || device.last_fix_at;
  if (!t) return "Never seen";
  const mins = Math.floor((Date.now() - new Date(t).getTime()) / 60000);
  if (mins < 3) return "Live";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function statusLabel(device: BeaconDevice): { text: string; tone: "ok" | "wait" | "bad" } {
  if (device.active_sos_alert_id) return { text: "SOS ACTIVE", tone: "bad" };
  if (device.status === "connected") {
    const t = device.last_seen_at || device.last_fix_at;
    const silentMins = t ? (Date.now() - new Date(t).getTime()) / 60000 : Infinity;
    if (silentMins > 120) return { text: "Silent for a while", tone: "wait" };
    return { text: "Connected", tone: "ok" };
  }
  if (device.status === "configuring") return { text: "Setting up", tone: "wait" };
  return { text: "Offline", tone: "bad" };
}

export function BeaconFleet({
  devices,
  onSelect,
  onPairAnother,
  onRefresh,
}: {
  devices: BeaconDevice[];
  onSelect: (device: BeaconDevice) => void;
  onPairAnother: () => void;
  onRefresh?: () => void;
}) {
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<"list" | "map">("list");
  const [importOpen, setImportOpen] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return devices;
    return devices.filter((d) =>
      (d.wearer_name || d.name || "").toLowerCase().includes(q) ||
      d.device_id.includes(q),
    );
  }, [devices, query]);

  const lowBattery = devices.filter((d) => d.battery_pct != null && d.battery_pct <= 20).length;
  const sosActive = devices.filter((d) => d.active_sos_alert_id).length;

  return (
    <div className="px-4 pb-24 max-w-md mx-auto">
      <div className="pt-2 pb-4 flex items-start justify-between gap-3">
        <div>
        <h1 className="text-xl font-bold text-dark-50">Your Beacons</h1>
        <p className="text-sm text-dark-400">
          {devices.length} device{devices.length === 1 ? "" : "s"}
          {sosActive > 0 && <span className="beacon-bad-text font-semibold">, {sosActive} SOS</span>}
          {lowBattery > 0 && <span className="beacon-wait-text">, {lowBattery} low battery</span>}
        </p>
        </div>
        {devices.length >= 10 && (
          <div className="flex rounded-xl bg-[var(--soft-surface)] p-0.5 shrink-0">
            {(["list", "map"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                aria-label={m === "list" ? "List view" : "Map view"}
                className={`px-2.5 py-1.5 rounded-[10px] transition-colors active:scale-[0.97] ${
                  mode === m ? "bg-primary-600 text-white" : "text-dark-400"
                }`}
              >
                {m === "list" ? <List className="w-4 h-4" /> : <MapIcon className="w-4 h-4" />}
              </button>
            ))}
          </div>
        )}
      </div>

      {mode === "map" && devices.length >= 10 && (
        <div className="mb-4">
          <BeaconFleetMap devices={devices} onSelect={onSelect} />
        </div>
      )}

      {mode === "list" && devices.length >= 8 && (
        <div className="relative mb-3">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-dark-500" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name or device ID"
            className="w-full glass-input rounded-xl pl-10 pr-4 text-sm text-dark-100 placeholder:text-dark-500"
          />
        </div>
      )}

      <div className={mode === "map" ? "hidden" : "space-y-2.5"}>
        {filtered.map((d) => {
          const st = statusLabel(d);
          const toneClass =
            st.tone === "ok" ? "beacon-ok-text" : st.tone === "wait" ? "beacon-wait-text" : "beacon-bad-text";
          return (
            <button
              key={d.id}
              onClick={() => onSelect(d)}
              className="w-full flex items-center gap-3.5 p-4 rounded-2xl bg-dark-800/50 border border-dark-700 text-left active:scale-[0.97] transition-transform"
            >
              <div
                className="w-11 h-11 rounded-full flex items-center justify-center shrink-0 text-white font-bold"
                style={{ background: d.wearer_color || "#8b5cf6" }}
              >
                {d.wearer_name ? d.wearer_name[0].toUpperCase() : <Radio className="w-5 h-5" />}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[15px] font-semibold text-dark-50 truncate">
                  {d.wearer_name || d.name || "Beacon"}
                </p>
                <p className="text-xs text-dark-400">
                  <span className={toneClass}>{st.text}</span>
                  <span className="text-dark-600"> · </span>
                  {lastSeenLabel(d)}
                </p>
              </div>
              {d.battery_pct != null && (
                <span
                  className={`flex items-center gap-1 text-xs tabular-nums shrink-0 ${
                    d.battery_pct <= 20 ? "beacon-bad-text" : "text-dark-400"
                  }`}
                >
                  {d.battery_pct <= 20 ? (
                    <BatteryLow className="w-4 h-4" />
                  ) : (
                    <Battery className="w-4 h-4" />
                  )}
                  {d.battery_pct}%
                </span>
              )}
              <ChevronRight className="w-4 h-4 text-dark-500 shrink-0" />
            </button>
          );
        })}
        {filtered.length === 0 && query && (
          <p className="text-sm text-dark-500 text-center py-6">
            No Beacon matches &quot;{query}&quot;.
          </p>
        )}
      </div>

      <button
        onClick={onPairAnother}
        className="mt-4 w-full flex items-center justify-center gap-1.5 py-3.5 rounded-2xl border border-dashed border-dark-600 text-sm font-medium text-primary-400 active:scale-[0.97] transition-transform"
      >
        <Plus className="w-4 h-4" /> Pair another Beacon
      </button>
      <button
        onClick={() => setImportOpen(true)}
        className="mt-2 w-full flex items-center justify-center gap-1.5 py-2.5 rounded-2xl text-xs font-medium text-dark-400 active:scale-[0.97] transition-transform"
      >
        <FileSpreadsheet className="w-3.5 h-3.5" /> Import many from CSV
      </button>

      <BeaconBulkImport
        isOpen={importOpen}
        onClose={() => setImportOpen(false)}
        onImported={() => onRefresh?.()}
      />
    </div>
  );
}
