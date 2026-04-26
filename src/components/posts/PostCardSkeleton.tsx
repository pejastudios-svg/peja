"use client";

import { Skeleton } from "@/components/ui/Skeleton";

export function PostCardSkeleton() {
  return (
    <div className="glass-card overflow-hidden">
      {/* header row */}
      <div className="flex items-center justify-between mb-3">
        <Skeleton className="h-3 w-40" />
        <Skeleton className="h-3 w-20" />
      </div>

      {/* media — match the real card's aspect-video frame so content lands
          in the same position when the skeleton swaps out */}
      <div className="-mx-6 mb-3">
        <Skeleton className="aspect-video w-full rounded-none" />
      </div>

      {/* badge */}
      <Skeleton className="h-6 w-28 mb-3" />

      {/* text */}
      <Skeleton className="h-4 w-full mb-2" />
      <Skeleton className="h-4 w-4/5 mb-3" />

      {/* stats */}
      <div className="flex items-center justify-between mb-4">
        <Skeleton className="h-4 w-16" />
        <Skeleton className="h-4 w-16" />
        <Skeleton className="h-4 w-16" />
      </div>

      {/* actions */}
      <div className="flex gap-2 pt-3 border-t border-white/5">
        <Skeleton className="h-10 flex-1" />
        <Skeleton className="h-10 flex-1" />
        <Skeleton className="h-10 w-10" />
      </div>
    </div>
  );
}