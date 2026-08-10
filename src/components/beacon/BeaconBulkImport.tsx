"use client";

import { useEffect, useRef, useState } from "react";
import { FileSpreadsheet, Upload } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { PejaSpinner } from "@/components/ui/PejaSpinner";
import { authFetchJson } from "@/lib/authFetch";
import { useToast } from "@/context/ToastContext";

// CSV onboarding for fleets. Columns: deviceId, sim, wearerName,
// contactPhone (optional). Every valid row becomes a device plus a queued
// over-the-air config job; the queue drains in the background a few texts
// a minute, and the progress line below tracks it.

interface ParsedRow {
  deviceId: string;
  sim: string;
  wearerName: string;
  contactPhone: string;
}

function parseCsv(text: string): ParsedRow[] {
  const rows: ParsedRow[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const cells = line.split(/[,;\t]/).map((c) => c.trim().replace(/^"|"$/g, ""));
    // Skip an obvious header row.
    if (/device/i.test(cells[0] || "") && /sim|phone/i.test(cells[1] || "")) continue;
    if (cells.length < 3) continue;
    rows.push({
      deviceId: cells[0] || "",
      sim: cells[1] || "",
      wearerName: cells[2] || "",
      contactPhone: cells[3] || "",
    });
  }
  return rows;
}

export function BeaconBulkImport({
  isOpen,
  onClose,
  onImported,
}: {
  isOpen: boolean;
  onClose: () => void;
  onImported: () => void;
}) {
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ queued: number; failed: number } | null>(null);
  const [progress, setProgress] = useState<{ queued: number; sending: number; done: number; failed: number } | null>(null);

  // Poll config progress while the modal is open and something is queued.
  useEffect(() => {
    if (!isOpen) return;
    let stop = false;
    const tick = async () => {
      const { data } = await authFetchJson("/api/beacon/bulk-import").catch(() => ({ data: null }) as any);
      if (!stop && data?.ok) setProgress(data.counts);
    };
    tick();
    const iv = setInterval(tick, 15000);
    return () => {
      stop = true;
      clearInterval(iv);
    };
  }, [isOpen, result]);

  const pickFile = async (file: File) => {
    const text = await file.text();
    const parsed = parseCsv(text);
    if (parsed.length === 0) {
      toast.warning("No usable rows. Expected columns: deviceId, sim, wearerName, contactPhone");
      return;
    }
    setRows(parsed);
    setResult(null);
  };

  const submit = async () => {
    setBusy(true);
    try {
      const { res, data } = await authFetchJson("/api/beacon/bulk-import", {
        method: "POST",
        body: JSON.stringify({ rows }),
      });
      if (!res.ok) throw new Error(data?.error || "Import failed");
      setResult({ queued: data.queued, failed: data.failed });
      setRows([]);
      onImported();
      if (data.failed > 0) {
        const firstErrors = (data.results || [])
          .filter((r: any) => !r.ok)
          .slice(0, 3)
          .map((r: any) => `row ${r.row}: ${r.error}`)
          .join(", ");
        toast.warning(`${data.failed} row${data.failed === 1 ? "" : "s"} skipped (${firstErrors})`);
      } else {
        toast.success(`${data.queued} Beacons queued for setup`);
      }
    } catch (e) {
      toast.warning(e instanceof Error ? e.message : "Import failed");
    } finally {
      setBusy(false);
    }
  };

  const totalJobs = progress ? progress.queued + progress.sending + progress.done + progress.failed : 0;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Import Beacons">
      <div className="space-y-4">
        <p className="text-sm text-dark-400 leading-relaxed">
          One line per device: <span className="text-dark-200 font-mono text-xs">deviceId, sim, wearerName, contactPhone</span>.
          The contact number becomes call button 1 and the SOS number for
          that device. Setup texts go out steadily in the background.
        </p>

        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv,text/plain"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void pickFile(f);
            e.target.value = "";
          }}
        />
        <button
          onClick={() => fileRef.current?.click()}
          className="w-full flex items-center justify-center gap-2 py-6 rounded-2xl border border-dashed border-dark-600 text-sm font-medium text-primary-400 active:scale-[0.97] transition-transform"
        >
          <FileSpreadsheet className="w-5 h-5" />
          {rows.length > 0 ? `${rows.length} devices ready` : "Choose a CSV file"}
        </button>

        {rows.length > 0 && (
          <div className="max-h-36 overflow-y-auto rounded-xl border border-[var(--hairline)] divide-y divide-[var(--hairline)]">
            {rows.slice(0, 25).map((r, i) => (
              <div key={i} className="flex items-center gap-2 px-3 py-1.5 text-xs">
                <span className="text-dark-100 font-medium flex-1 truncate">{r.wearerName || "?"}</span>
                <span className="text-dark-500 font-mono">{r.deviceId}</span>
              </div>
            ))}
            {rows.length > 25 && (
              <p className="px-3 py-1.5 text-[11px] text-dark-500">and {rows.length - 25} more</p>
            )}
          </div>
        )}

        <button
          onClick={submit}
          disabled={busy || rows.length === 0}
          className="w-full py-3 rounded-2xl bg-primary-600 text-white text-sm font-semibold active:scale-[0.97] transition-transform disabled:opacity-40 flex items-center justify-center gap-2"
        >
          {busy ? <PejaSpinner className="w-4 h-4" /> : <Upload className="w-4 h-4" />}
          Import and start setup
        </button>

        {totalJobs > 0 && progress && (
          <div className="p-3 rounded-xl bg-[var(--soft-surface)]">
            <div className="flex items-center justify-between text-xs mb-1.5">
              <span className="text-dark-300 font-medium">Setup progress</span>
              <span className="text-dark-400 tabular-nums">
                {progress.done} of {totalJobs} configured
                {progress.failed > 0 && (
                  <span className="beacon-bad-text">, {progress.failed} failed</span>
                )}
              </span>
            </div>
            <div className="h-1.5 rounded-full bg-[var(--soft-surface-strong)] overflow-hidden">
              <div
                className="h-full bg-primary-500 rounded-full"
                style={{
                  width: `${Math.round((progress.done / Math.max(1, totalJobs)) * 100)}%`,
                  transition: "width 300ms var(--ease-out)",
                }}
              />
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
