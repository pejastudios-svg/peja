"use client";

import { CATEGORIES } from "@/lib/types";
import { REPORT_CATEGORY_COLORS, REPORT_CATEGORY_ICONS } from "./reportCategories";

interface ReportThreatPickerProps {
  value: string;
  onChange: (categoryId: string) => void;
}

export function ReportThreatPicker({ value, onChange }: ReportThreatPickerProps) {
  const options = CATEGORIES.filter((cat) => cat.id !== "crime" && cat.id !== "fire");

  return (
    <section className="report-section">
      <h2 className="report-section-title">Threat level</h2>
      <p className="report-section-hint mb-3">Required — choose the type that best matches this incident.</p>
      <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1 scrollbar-hide">
        {options.map((cat) => {
          const colors = REPORT_CATEGORY_COLORS[cat.id] || REPORT_CATEGORY_COLORS.general;
          const icon = REPORT_CATEGORY_ICONS[cat.id] || REPORT_CATEGORY_ICONS.general;
          const isSelected = value === cat.id;

          return (
            <button
              key={cat.id}
              type="button"
              onClick={() => onChange(cat.id)}
              className="report-threat-pill"
              style={
                isSelected
                  ? {
                      background: colors.bg,
                      borderColor: colors.border,
                      color: colors.text,
                    }
                  : undefined
              }
            >
              <span style={{ color: isSelected ? colors.text : "var(--color-dark-400)" }}>{icon}</span>
              {cat.name}
            </button>
          );
        })}
      </div>
    </section>
  );
}
