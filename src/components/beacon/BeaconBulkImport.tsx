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

/** Which separator this file actually uses. Counted outside quotes, over
 *  the first few lines, so a name containing a comma cannot sway it. */
function detectDelimiter(text: string): string {
  const counts: Record<string, number> = { ",": 0, ";": 0, "\t": 0 };
  let inQuotes = false;
  let lines = 0;
  for (let i = 0; i < text.length && lines < 5; i++) {
    const ch = text[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (inQuotes) continue;
    if (ch === "\n") {
      lines++;
      continue;
    }
    if (ch in counts) counts[ch] += 1;
  }
  return (Object.keys(counts) as string[]).reduce((a, b) => (counts[b] > counts[a] ? b : a), ",");
}

/** RFC 4180 tokenizer. Quoted fields may contain the separator, line
 *  breaks, and doubled quotes. Splitting on a regex got this wrong, and
 *  the failure was silent: "Okonkwo, Ada" became the name "Okonkwo" and
 *  the contact phone "Ada", which the server then dropped, leaving a
 *  Beacon provisioned with nobody to call. */
function tokenizeCsv(text: string, delim: string): string[][] {
  const table: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === delim) {
      row.push(cell);
      cell = "";
      continue;
    }
    if (ch === "\r") continue;
    if (ch === "\n") {
      row.push(cell);
      table.push(row);
      row = [];
      cell = "";
      continue;
    }
    cell += ch;
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    table.push(row);
  }
  return table;
}

/** `skipped` is reported rather than swallowed: a half-imported fleet
 *  with no mention of the rest is how people end up believing a device
 *  is configured when it never was. */
function parseCsv(text: string): { rows: ParsedRow[]; skipped: number } {
  // Excel on Windows writes a BOM; it would ride along on the first cell.
  const clean = text.replace(/^\uFEFF/, "");
  const table = tokenizeCsv(clean, detectDelimiter(clean));
  const rows: ParsedRow[] = [];
  let skipped = 0;

  for (const raw of table) {
    const cells = raw.map((c) => c.trim());
    if (cells.every((c) => c === "")) continue; // blank line, not a failure
    // Header row.
    if (/device|id/i.test(cells[0] || "") && /sim|phone|msisdn/i.test(cells[1] || "")) continue;
    if (cells.length < 3 || !cells[0] || !cells[1] || !cells[2]) {
      skipped += 1;
      continue;
    }
    rows.push({
      deviceId: cells[0],
      sim: cells[1],
      wearerName: cells[2],
      contactPhone: cells[3] || "",
    });
  }
  return { rows, skipped };
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
    const { rows: parsed, skipped } = parseCsv(text);
    if (parsed.length === 0) {
      toast.warning("No usable rows. Expected columns: deviceId, sim, wearerName, contactPhone");
      return;
    }
    // Say what was dropped at the door, not after the import.
    if (skipped > 0) {
      toast.warning(
        `${skipped} line${skipped === 1 ? "" : "s"} skipped: needs device ID, SIM and wearer name`,
      );
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
