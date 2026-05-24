import { Skeleton } from "@/components/ui/Skeleton";

export default function Loading() {
  return (
    <div className="min-h-screen bg-[var(--page-bg)]">
      <div className="fixed top-0 left-0 right-0 z-40 glass-header">
        <div className="max-w-2xl mx-auto px-4 h-12 flex items-center justify-between">
          <Skeleton className="h-9 w-9 rounded-lg" />
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-9 w-9 rounded-lg" />
        </div>
      </div>
      <main className="report-page-main pt-app-header-pill px-4 max-w-2xl mx-auto">
        {/* Evidence */}
        <div className="report-section">
          <div className="flex items-center justify-between mb-2">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-3 w-10" />
          </div>
          <Skeleton className="h-3 w-full max-w-xs mb-3" />
          <div className="flex gap-2 overflow-hidden mb-3">
            <Skeleton className="report-media-thumb shrink-0 rounded-lg" />
            <Skeleton className="report-media-thumb shrink-0 rounded-lg" />
            <Skeleton className="report-media-thumb shrink-0 rounded-lg" />
          </div>
          <div className="flex gap-2">
            <Skeleton className="h-10 w-24 rounded-full" />
            <Skeleton className="h-10 w-24 rounded-full" />
            <Skeleton className="h-10 w-24 rounded-full" />
          </div>
        </div>

        {/* Location */}
        <div className="report-section">
          <Skeleton className="h-3 w-20 mb-3" />
          <Skeleton className="h-14 w-full rounded-xl" />
        </div>

        {/* Threat level */}
        <div className="report-section">
          <Skeleton className="h-3 w-24 mb-2" />
          <Skeleton className="h-3 w-full max-w-sm mb-3" />
          <div className="flex gap-2 overflow-hidden">
            <Skeleton className="h-10 w-28 rounded-full shrink-0" />
            <Skeleton className="h-10 w-32 rounded-full shrink-0" />
            <Skeleton className="h-10 w-24 rounded-full shrink-0" />
          </div>
        </div>

        {/* Description */}
        <div className="report-section">
          <Skeleton className="h-3 w-24 mb-2" />
          <Skeleton className="h-28 w-full rounded-xl" />
        </div>

        {/* Tags */}
        <div className="report-section">
          <Skeleton className="h-3 w-12 mb-2" />
          <Skeleton className="h-11 w-full rounded-xl" />
        </div>

        {/* Sensitive */}
        <div className="report-section">
          <Skeleton className="h-14 w-full rounded-xl" />
        </div>

        <div className="report-submit-bar pt-2">
          <Skeleton className="h-12 w-full rounded-xl" />
        </div>
      </main>
    </div>
  );
}
