import { Skeleton } from "@/components/ui/Skeleton";
import { Header } from "@/components/layout/Header";

export default function Loading() {
  return (
    <div className="min-h-screen pb-8">
      <Header variant="back" title="Incident Details" />
      <main className="pt-app-header-pill px-4 max-w-2xl mx-auto space-y-4">
        <Skeleton className="h-40 w-full rounded-2xl" />
        <Skeleton className="h-20 w-full rounded-2xl" />
        <Skeleton className="h-40 w-full rounded-2xl" />
        <Skeleton className="h-24 w-full rounded-2xl" />
        <Skeleton className="h-12 w-full rounded-2xl" />
      </main>
    </div>
  );
}
