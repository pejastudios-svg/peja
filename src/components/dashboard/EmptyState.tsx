"use client";

import { Inbox, type LucideIcon } from "lucide-react";

// Shared empty / "no results" state for the admin area. One look everywhere:
// a neutral circular icon, a title, and an optional one-line description.
export default function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  className = "",
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  className?: string;
}) {
  return (
    <div className={`flex flex-col items-center justify-center text-center py-16 ${className}`}>
      <div className="w-16 h-16 rounded-full bg-white/5 border border-white/[0.07] flex items-center justify-center mb-4">
        <Icon className="w-7 h-7 text-dark-500" strokeWidth={1.75} />
      </div>
      <p className="text-dark-300 font-medium text-lg">{title}</p>
      {description && (
        <p className="text-sm text-dark-500 mt-1 max-w-sm">{description}</p>
      )}
    </div>
  );
}
