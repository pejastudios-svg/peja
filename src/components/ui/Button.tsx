"use client";

import { forwardRef, ButtonHTMLAttributes } from "react";
import { Loader2 } from "lucide-react";
import { PejaSpinner } from "./PejaSpinner";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
  isLoading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      children,
      variant = "primary",
      size = "md",
      isLoading = false,
      leftIcon,
      rightIcon,
      className = "",
      disabled,
      ...props
    },
    ref
  ) => {
    const baseStyles =
      "inline-flex items-center justify-center font-medium transition-all duration-200 " +
      "active:scale-[0.97] disabled:active:scale-100 disabled:opacity-50 disabled:cursor-not-allowed " +
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/60";

    // Inner top light (inset highlight) is the premium-glass cue - cheap,
    // no backdrop-filter involved. See PEJA_DESIGN_SYSTEM.md.
    const variants = {
      primary:
        "bg-gradient-to-b from-primary-500 to-primary-700 hover:from-primary-600 hover:to-primary-700 text-white " +
        "shadow-[inset_0_1px_0_rgba(255,255,255,0.2),0_2px_8px_rgba(0,0,0,0.25),0_8px_24px_rgba(124,58,237,0.25)]",
      secondary:
        "glass-sm text-dark-100 hover:bg-white/10",
      ghost: "text-dark-100 hover:bg-white/5",
      danger:
        "bg-gradient-to-b from-red-500 to-red-700 hover:from-red-600 hover:to-red-700 text-white " +
        "shadow-[inset_0_1px_0_rgba(255,255,255,0.2),0_2px_8px_rgba(0,0,0,0.25)]",
    };

    const sizes = {
      sm: "text-sm px-3 py-1.5 rounded-[10px] gap-1.5",
      md: "text-sm px-4 py-2.5 rounded-[14px] gap-2",
      lg: "text-base px-6 py-3 rounded-[14px] gap-2",
    };

    return (
      <button
        ref={ref}
        className={`${baseStyles} ${variants[variant]} ${sizes[size]} ${className}`}
        disabled={disabled || isLoading}
        {...props}
      >
        {isLoading ? (
          <PejaSpinner className="w-4 h-4" />
        ) : (
          leftIcon
        )}
        {children}
        {!isLoading && rightIcon}
      </button>
    );
  }
);

Button.displayName = "Button";