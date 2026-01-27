"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import WatchClient from "./WatchClient";

function WatchPageContent() {
  const searchParams = useSearchParams();
  const startId = searchParams?.get("v") ?? null;
  const source = searchParams?.get("source") ?? null;
  const sourceKey = searchParams?.get("key") ?? null;

  return <WatchClient startId={startId} source={source} sourceKey={sourceKey} />;
}

export default function WatchPage() {
  return (
    <Suspense fallback={<div className="fixed inset-0 bg-black z-[9999]" />}>
      <WatchPageContent />
    </Suspense>
  );
}