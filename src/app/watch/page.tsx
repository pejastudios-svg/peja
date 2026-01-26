"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import WatchClient from "./WatchClient";

function WatchPageContent() {
  const searchParams = useSearchParams();
  const startId = searchParams.get("v");
  const source = searchParams.get("source");
  const sourceKey = searchParams.get("key");

  return <WatchClient startId={startId} source={source} sourceKey={sourceKey} />;
}

export default function WatchPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-black" />}>
      <WatchPageContent />
    </Suspense>
  );
}