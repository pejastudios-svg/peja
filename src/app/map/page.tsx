import { Suspense } from "react";
import MapClient from "./MapClient";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function MapPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-dark-950 text-dark-100">
          Loading map...
        </div>
      }
    >
      <MapClient />
    </Suspense>
  );
}