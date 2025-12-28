import WatchClient from "./WatchClient";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function WatchPage({
  searchParams,
}: {
  searchParams: Promise<{ postId?: string; source?: string }>;
}) {
  const sp = await searchParams;

  return <WatchClient startId={sp.postId ?? null} source={sp.source ?? null} />;
}