"use client";

import { HTMLAttributes } from "react";

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: "danger" | "warning" | "info" | "success" | "default";
}

export function Badge({
  children,
  variant = "default",
  className = "",
  ...props
}: BadgeProps) {
  const variants = {
    danger: "badge-danger",
    warning: "badge-warning",
    info: "badge-info",
    success: "badge-success",
    default: "badge bg-dark-500/20 text-dark-300 border border-dark-500/30",
  };

  return (
    <span
      className={`badge ${variants[variant]} ${className}`}
      {...props}
    >
      {children}
    </span>
  );
}