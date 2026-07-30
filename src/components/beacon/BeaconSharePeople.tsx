"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronRight, Users } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { AvatarImage } from "@/components/ui/AvatarImage";
import { PejaSpinner } from "@/components/ui/PejaSpinner";
import { useToast } from "@/context/ToastContext";
import { authFetchJson } from "@/lib/authFetch";
import { Toggle } from "@/components/ui/Toggle";

// Person-by-person control over who sees this Beacon. Everyone is on by
// default; switching someone off hides the device from them only. Kept
// separate from the owner's own location sharing on purpose: the Beacon
// is often a device bought FOR someone else.

interface Row {
  id: string;
  name: string;
  avatar: string | null;
  visible: boolean;
}

export function BeaconSharePeople({
  deviceId,
  enabled,
}: {
  deviceId: string;
  /** Global sharing switch. When off, nobody sees it and this is moot. */
  enabled: boolean;
}) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { res, data } = await authFetchJson(
        `/api/beacon/share?deviceId=${encodeURIComponent(deviceId)}`,
      );
      if (res.ok) setRows((data?.contacts || []) as Row[]);
    } finally {
      setLoading(false);
    }
  }, [deviceId]);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  const toggle = async (row: Row) => {
    const next = !row.visible;
    setBusy(row.id);
    setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, visible: next } : r)));
    const { res, data } = await authFetchJson("/api/beacon/share", {
      method: "POST",
      body: JSON.stringify({ deviceId, contactUserId: row.id, visible: next }),
    });
    setBusy(null);
    if (!res.ok) {
      setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, visible: !next } : r)));
      toast.warning(data?.error || "Could not update");
      return;
    }
    toast.success(
      next
        ? `${row.name.split(" ")[0]} can see this Beacon`
        : `Hidden from ${row.name.split(" ")[0]}`,
    );
  };

  const hiddenCount = rows.filter((r) => !r.visible).length;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        disabled={!enabled}
        className="w-full flex items-center gap-3 p-3.5 rounded-2xl bg-dark-800/50 border border-dark-700 active:scale-[0.985] transition-transform disabled:opacity-50"
      >
        <div className="w-9 h-9 rounded-full bg-primary-500/15 flex items-center justify-center shrink-0">
          <Users className="beacon-accent-text w-4.5 h-4.5" />
        </div>
        <div className="flex-1 min-w-0 text-left">
          <p className="text-sm font-semibold text-dark-100">Who can see this Beacon</p>
          <p className="text-xs text-dark-500">
            {!enabled
              ? "Turn on sharing above to choose people"
              : hiddenCount > 0
                ? `Hidden from ${hiddenCount} ${hiddenCount === 1 ? "person" : "people"}`
                : "Everyone in your emergency contacts"}
          </p>
        </div>
        <ChevronRight className="w-4 h-4 text-dark-500 shrink-0" />
      </button>

      <Modal isOpen={open} onClose={() => setOpen(false)} title="Who can see this Beacon">
        <div className="space-y-3">
          <p className="text-xs text-dark-400 leading-relaxed">
            Everyone in your emergency contacts can see it unless you switch
            them off here. Switching someone off hides only this Beacon, not
            your own location.
          </p>

          {loading ? (
            <div className="flex justify-center py-8">
              <PejaSpinner />
            </div>
          ) : rows.length === 0 ? (
            <p className="text-sm text-dark-500 text-center py-6">
              You have no accepted emergency contacts yet.
            </p>
          ) : (
            <div className="space-y-2">
              {rows.map((r) => (
                <div
                  key={r.id}
                  className="flex items-center gap-3 p-2.5 rounded-2xl bg-dark-800/60 border border-dark-700"
                >
                  <div className="w-9 h-9 rounded-full overflow-hidden bg-dark-700 flex items-center justify-center shrink-0">
                    {r.avatar ? (
                      <AvatarImage src={r.avatar} wrapperClassName="w-full h-full" />
                    ) : (
                      <Users className="w-4 h-4 text-dark-400" />
                    )}
                  </div>
                  <p className="flex-1 min-w-0 text-sm text-dark-100 truncate">{r.name}</p>
                  <Toggle
                    on={r.visible}
                    disabled={busy === r.id}
                    onChange={() => toggle(r)}
                  />
                </div>
              ))}
            </div>
          )}

          <button
            onClick={() => setOpen(false)}
            className="w-full py-3 rounded-2xl bg-primary-600 text-white text-sm font-semibold active:scale-[0.98] transition-transform"
          >
            Done
          </button>
        </div>
      </Modal>
    </>
  );
}
