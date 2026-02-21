import { Skeleton } from "@/components/ui/Skeleton";

export default function MessagesLoading() {
  return (
    <div className="min-h-screen pb-20">
      <div className="fixed top-0 left-0 right-0 z-40 glass-header">
        <div className="max-w-2xl mx-auto px-4 h-14 flex items-center justify-between">
          <Skeleton className="w-5 h-5 rounded" />
          <Skeleton className="w-24 h-5 rounded" />
          <Skeleton className="w-5 h-5 rounded" />
        </div>
      </div>
      <div className="pt-16 px-4 space-y-1">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 p-3">
            <Skeleton className="w-[52px] h-[52px] rounded-full shrink-0" />
            <div className="flex-1">
              <div className="flex justify-between">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-3 w-12" />
              </div>
              <Skeleton className="h-3 w-48 mt-2" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}