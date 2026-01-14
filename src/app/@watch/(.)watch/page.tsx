import FullScreenModalShell from "@/components/navigation/FullScreenModalShell";
import WatchClient from "@/app/watch/WatchClient";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function WatchStackPage({
  searchParams,
}: {
  searchParams: Promise<{ postId?: string; source?: string; sourceKey?: string }>;
}) {
  const sp = await searchParams;

  return (
    <FullScreenModalShell
      closeOnBackdrop={false}
      zIndex={11000}
      scrollable={false}
      closeEventName="peja-close-watch"
    >
      <WatchClient
        startId={sp.postId ?? null}
        source={sp.source ?? null}
        sourceKey={sp.sourceKey ?? null}
      />
    </FullScreenModalShell>
  );
}