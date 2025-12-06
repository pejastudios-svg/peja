"use client";

import { ReactNode } from "react";

interface BadgeProps {
  children: ReactNode;
  variant?: "danger" | "warning" | "info" | "success";
  className?: string;
}

export function Badge({ children, variant = "info", className = "" }: BadgeProps) {
  const variants = {
    danger: "badge-danger",
    warning: "badge-warning",
    info: "badge-info",
    success: "badge-success",
  };

  return (
    <span className={`badge ${variants[variant]} ${className}`}>
      {children}
    </span>
  );
}