"use client";

interface OnlineDotProps {
  isOnline: boolean;
  size?: "sm" | "md" | "lg";
  className?: string;
}

export function OnlineDot({ isOnline, size = "md", className = "" }: OnlineDotProps) {
  const sizes = {
    sm: "w-2 h-2",
    md: "w-2.5 h-2.5",
    lg: "w-3 h-3",
  };

  if (!isOnline) return null;

  return (
    <span
      className={`absolute bottom-0 right-0 ${sizes[size]} rounded-full bg-green-500 border-2 border-dark-950 online-dot-pulse ${className}`}
    />
  );
}