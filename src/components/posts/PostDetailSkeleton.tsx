"use client";

import { Skeleton } from "@/components/ui/Skeleton";

export function PostDetailSkeleton() {
  return (
    <div className="min-h-screen pb-32">
      {/* fixed header placeholder */}
      <div className="fixed top-0 left-0 right-0 z-50 glass-header">
        <div className="flex items-center justify-between px-4 h-14 max-w-2xl mx-auto">
          <Skeleton className="h-9 w-9 rounded-lg" />
          <Skeleton className="h-4 w-36" />
          <Skeleton className="h-9 w-9 rounded-lg" />
        </div>
      </div>

      <main className="pt-14 max-w-2xl mx-auto">
        {/* media */}
        <Skeleton className="h-[240px] w-full rounded-none" />

        <div className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <Skeleton className="h-6 w-28" />
            <Skeleton className="h-4 w-16" />
          </div>

          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-4/5" />

          <div className="flex gap-3">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 w-24" />
          </div>

          <div className="flex gap-2 pt-2">
            <Skeleton className="h-11 flex-1" />
            <Skeleton className="h-11 w-11" />
          </div>
        </div>

        {/* comments */}
        <div className="border-t border-white/5 p-4 space-y-4">
          <Skeleton className="h-5 w-36" />

          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex gap-3">
              <Skeleton className="h-8 w-8 rounded-full shrink-0" />
              <div className="flex-1">
                <Skeleton className="h-3 w-32 mb-2" />
                <Skeleton className="h-4 w-full mb-2" />
                <Skeleton className="h-4 w-3/4" />
              </div>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}