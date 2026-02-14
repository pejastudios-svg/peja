import { Skeleton } from "@/components/ui/Skeleton";

export default function ChatLoading() {
  return (
    <div className="fixed inset-0 flex flex-col bg-[#0a0812]">
      <div className="glass-header h-14 flex items-center gap-3 px-4 shrink-0">
        <Skeleton className="w-5 h-5 rounded" />
        <Skeleton className="w-10 h-10 rounded-full" />
        <div>
          <Skeleton className="w-28 h-4 mb-1" />
          <Skeleton className="w-16 h-3" />
        </div>
      </div>
      <div className="flex-1 p-4 space-y-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className={`flex ${i % 3 !== 0 ? "justify-end" : "justify-start"}`}>
            <Skeleton className={`h-12 rounded-2xl ${i % 3 !== 0 ? "w-40" : "w-52"}`} />
          </div>
        ))}
      </div>
      <div className="px-3 py-3 border-t border-white/5">
        <Skeleton className="h-10 w-full rounded-2xl" />
      </div>
    </div>
  );
}