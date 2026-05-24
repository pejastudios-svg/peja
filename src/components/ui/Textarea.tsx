"use client";

import { forwardRef, TextareaHTMLAttributes } from "react";
import { FormField } from "./FormField";

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  hint?: string;
  error?: string;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ label, hint, error, className = "", ...props }, ref) => {
    return (
      <FormField label={label} hint={hint} error={error}>
        <textarea ref={ref} className={`peja-textarea ${className}`} {...props} />
      </FormField>
    );
  }
);

Textarea.displayName = "Textarea";
