"use client";

// Floating glass action bar that replaces the standard header while
// the conversation list is in multi-select mode. Mirrors WhatsApp /
// iMessage: dismiss (X) on the left, "N selected" + select-all toggle
// in the middle, bulk actions on the right.
//
// Phase 4 Round 2 only ships bulk DELETE (the highest-impact action).
// Bulk mute / block can be added later by appending more buttons.

import { X, CheckSquare, Square, Trash2 } from "lucide-react";

interface Props {
  selectedCount: number;
  totalCount: number;
  onCancel: () => void;
  onSelectAll: () => void;
  onBulkDelete: () => void;
}

const GLASS: React.CSSProperties = {
  background: "var(--glass-header-bg)",
  backdropFilter: "blur(20px) saturate(180%)",
  WebkitBackdropFilter: "blur(20px) saturate(180%)",
  border: "1px solid var(--glass-border)",
  boxShadow: "var(--glass-shadow-header)",
  borderRadius: "16px",
};

export function SelectActionBar({
  selectedCount,
  totalCount,
  onCancel,
  onSelectAll,
  onBulkDelete,
}: Props) {
  const allSelected = selectedCount > 0 && selectedCount === totalCount;
  return (
    <header
      className="fixed top-0 left-0 right-0 z-50 peja-fade-in-scale"
      style={{
        paddingTop:
          "calc(max(var(--app-top-inset, env(safe-area-inset-top, 0px)), 16px) + 8px)",
      }}
    >
      <div className="flex items-center gap-2 px-3 pt-2">
        <div
          className="flex items-center h-11 px-2 flex-1 min-w-0 gap-1.5"
          style={GLASS}
        >
          <button
            type="button"
            onClick={onCancel}
            className="p-1.5 rounded-lg active:opacity-70 transition-opacity shrink-0"
            aria-label="Cancel select"
          >
            <X className="w-5 h-5 text-dark-200" strokeWidth={2.5} />
          </button>
          <button
            type="button"
            onClick={onSelectAll}
            className="p-1.5 rounded-lg active:opacity-70 transition-opacity shrink-0"
            aria-label={allSelected ? "Deselect all" : "Select all"}
          >
            {allSelected ? (
              <CheckSquare className="w-5 h-5 text-primary-300" strokeWidth={2.3} />
            ) : (
              <Square className="w-5 h-5 text-dark-200" strokeWidth={2.3} />
            )}
          </button>
          <span className="text-[15px] font-semibold text-dark-100 truncate flex-1">
            {selectedCount === 0
              ? "Select chats"
              : `${selectedCount} selected`}
          </span>
        </div>

        <div className="flex items-center h-11 px-1.5 gap-0.5" style={GLASS}>
          <button
            type="button"
            onClick={onBulkDelete}
            disabled={selectedCount === 0}
            className="relative p-2 rounded-xl active:bg-white/10 transition-colors disabled:opacity-40 disabled:cursor-default"
            aria-label="Delete selected"
          >
            <Trash2 className="w-5 h-5 text-red-400" strokeWidth={2.3} />
          </button>
        </div>
      </div>
    </header>
  );
}
