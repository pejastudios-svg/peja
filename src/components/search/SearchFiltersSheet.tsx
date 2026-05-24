"use client";

import { useEffect, useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X, MapPin } from "lucide-react";
import { CATEGORIES } from "@/lib/types";
import { useScrollFreeze } from "@/hooks/useScrollFreeze";

const LOCATION_PRESETS = [
  "Lagos",
  "Lekki",
  "Victoria Island",
  "Ikeja",
  "Yaba",
] as const;

type DateRange = "today" | "week" | "month" | "all";

export interface SearchFiltersSheetProps {
  isOpen: boolean;
  onClose: () => void;
  selectedCategory: string | null;
  onCategoryChange: (categoryId: string | null) => void;
  locationFilter: string;
  onLocationFilterChange: (value: string) => void;
  dateRange: DateRange;
  onDateRangeChange: (range: DateRange) => void;
  onClearAll: () => void;
  hasActiveFilters: boolean;
  resultCount?: number;
}

export function SearchFiltersSheet({
  isOpen,
  onClose,
  selectedCategory,
  onCategoryChange,
  locationFilter,
  onLocationFilterChange,
  dateRange,
  onDateRangeChange,
  onClearAll,
  hasActiveFilters,
  resultCount,
}: SearchFiltersSheetProps) {
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);

  useScrollFreeze(isOpen);

  // Mount/unmount shell
  useEffect(() => {
    if (isOpen) {
      setMounted(true);
      return;
    }
    setVisible(false);
    const t = setTimeout(() => setMounted(false), 300);
    return () => clearTimeout(t);
  }, [isOpen]);

  // Enter: paint off-screen first, then slide in on the next frame
  useLayoutEffect(() => {
    if (!isOpen || !mounted) return;

    setVisible(false);
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => setVisible(true));
    });

    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, [isOpen, mounted]);

  if (!mounted || typeof document === "undefined") return null;

  const doneLabel =
    resultCount !== undefined
      ? `Show ${resultCount} result${resultCount !== 1 ? "s" : ""}`
      : "Show results";

  return createPortal(
    <div
      className="fixed inset-0 z-[70] flex flex-col"
      role="dialog"
      aria-modal="true"
      aria-labelledby="search-filters-title"
    >
      <div
        className={`absolute inset-0 bg-black/50 transition-opacity duration-300 ease-out ${
          visible ? "opacity-100" : "opacity-0"
        }`}
        onClick={onClose}
        aria-hidden
      />

      <div
        className={`relative flex flex-col flex-1 min-h-0 bg-[var(--page-bg)] transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] will-change-transform ${
          visible ? "translate-x-0" : "translate-x-full"
        }`}
        style={{
          paddingTop: "env(safe-area-inset-top, 0px)",
          paddingBottom: "env(safe-area-inset-bottom, 0px)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="shrink-0 glass-header border-b border-[var(--border-subtle)]">
          <div className="max-w-2xl mx-auto h-11 px-4 flex items-center gap-3">
            <button
              type="button"
              onClick={onClose}
              className="w-10 h-10 -ml-1 rounded-full flex items-center justify-center active:opacity-70"
              aria-label="Close filters"
            >
              <X className="w-6 h-6 text-dark-100" strokeWidth={2.5} />
            </button>
            <h2 id="search-filters-title" className="flex-1 text-base font-semibold text-dark-100">
              Filters
            </h2>
            {hasActiveFilters && (
              <button
                type="button"
                onClick={onClearAll}
                className="text-sm font-medium text-primary-400 active:opacity-70 shrink-0"
              >
                Clear all
              </button>
            )}
          </div>
        </header>

        <div className="flex-1 overflow-y-auto overscroll-contain">
          <div className="max-w-2xl mx-auto px-4 py-5 space-y-6">
            <div>
              <label className="report-section-title block mb-3">Category</label>
              <div className="flex flex-wrap gap-2">
                {CATEGORIES.slice(0, 8).map((cat) => (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() =>
                      onCategoryChange(selectedCategory === cat.id ? null : cat.id)
                    }
                    className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                      selectedCategory === cat.id
                        ? "bg-primary-600 text-white"
                        : "glass-sm text-dark-300 active:opacity-85"
                    }`}
                  >
                    {cat.name}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="report-section-title block mb-3">Location</label>
              <div className="peja-input-icon-wrap mb-3">
                <MapPin className="peja-input-icon" aria-hidden />
                <input
                  type="text"
                  value={locationFilter}
                  onChange={(e) => onLocationFilterChange(e.target.value)}
                  placeholder="Filter by area or address…"
                  className="peja-input text-base"
                />
              </div>
              <div className="flex flex-wrap gap-2">
                {LOCATION_PRESETS.map((loc) => (
                  <button
                    key={loc}
                    type="button"
                    onClick={() =>
                      onLocationFilterChange(
                        locationFilter.toLowerCase() === loc.toLowerCase() ? "" : loc
                      )
                    }
                    className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors inline-flex items-center gap-1.5 ${
                      locationFilter.toLowerCase() === loc.toLowerCase()
                        ? "bg-primary-600 text-white"
                        : "glass-sm text-dark-300 active:opacity-85"
                    }`}
                  >
                    <MapPin className="w-3.5 h-3.5 shrink-0 opacity-80" />
                    {loc}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="report-section-title block mb-3">Time period</label>
              <div className="flex flex-wrap gap-2">
                {(
                  [
                    { value: "today", label: "Today" },
                    { value: "week", label: "This week" },
                    { value: "month", label: "This month" },
                    { value: "all", label: "All time" },
                  ] as const
                ).map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => onDateRangeChange(option.value)}
                    className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                      dateRange === option.value
                        ? "bg-primary-600 text-white"
                        : "glass-sm text-dark-300 active:opacity-85"
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        <footer className="shrink-0 border-t border-[var(--border-subtle)] bg-[var(--page-bg)] px-4 py-3">
          <div className="max-w-2xl mx-auto">
            <button
              type="button"
              onClick={onClose}
              className="w-full py-3.5 rounded-xl font-semibold text-white active:opacity-90"
              style={{
                background: "linear-gradient(135deg, #7c3aed 0%, #6d28d9 100%)",
              }}
            >
              {doneLabel}
            </button>
          </div>
        </footer>
      </div>
    </div>,
    document.body
  );
}
