"use client";

import { forwardRef, InputHTMLAttributes } from "react";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, leftIcon, rightIcon, className = "", type, ...props }, ref) => {
    // Special handling for date/time inputs
    const isDateOrTime = type === "date" || type === "time";
    
    return (
      <div className="w-full">
        {label && <label className="peja-field-label">{label}</label>}
        <div className="relative">
          {leftIcon && (
            <div className="absolute left-4 top-1/2 -translate-y-1/2 text-dark-400 pointer-events-none z-10">
              {leftIcon}
            </div>
          )}
          <input
            ref={ref}
            type={type}
            className={`
              peja-input
              ${leftIcon ? "pl-12" : ""}
              ${rightIcon || isDateOrTime ? "pr-12" : ""}
              ${error ? "border-red-500/50 focus:border-red-500/50" : ""}
              ${className}
            `}
            {...props}
          />
          {rightIcon && (
            <div className="absolute right-4 top-1/2 -translate-y-1/2 text-dark-400 z-10">
              {rightIcon}
            </div>
          )}
        </div>
        {error && <p className="peja-field-error">{error}</p>}
      </div>
    );
  }
);

Input.displayName = "Input";