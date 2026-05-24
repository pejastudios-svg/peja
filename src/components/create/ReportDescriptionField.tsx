"use client";

import { Textarea } from "@/components/ui/Textarea";

interface ReportDescriptionFieldProps {
  value: string;
  onChange: (value: string) => void;
}

export function ReportDescriptionField({ value, onChange }: ReportDescriptionFieldProps) {
  return (
    <section className="report-section">
      <Textarea
        label="Description"
        hint="Optional — what happened, who was involved, direction of travel, etc."
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="What's happening?"
        rows={4}
      />
    </section>
  );
}
