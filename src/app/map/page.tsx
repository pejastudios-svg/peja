import { Suspense } from "react";
import MapClient from "./MapClient";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function MapPage() {
  return (
    <Suspense
      fallback={
  <div className="min-h-screen bg-dark-950 p-6">
    <div className="max-w-2xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <div className="skeleton h-4 w-28" />
        <div className="skeleton h-9 w-9 rounded-lg" />
      </div>
      <div className="skeleton h-[70vh] w-full rounded-2xl" />
      <div className="skeleton h-14 w-full rounded-2xl" />
    </div>
  </div>
}
    >
      <MapClient />
    </Suspense>
  );
}