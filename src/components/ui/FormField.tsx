"use client";

import type { ReactNode } from "react";

interface FormFieldProps {
  label?: string;
  hint?: string;
  error?: string;
  children: ReactNode;
  className?: string;
}

export function FormField({ label, hint, error, children, className = "" }: FormFieldProps) {
  return (
    <div className={`w-full ${className}`}>
      {label && <span className="peja-field-label">{label}</span>}
      {children}
      {hint && !error && <p className="peja-field-hint">{hint}</p>}
      {error && <p className="peja-field-error">{error}</p>}
    </div>
  );
}
