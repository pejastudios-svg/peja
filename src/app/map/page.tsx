import { Suspense } from "react";
import MapClient from "./MapClient";

// /map is the INCIDENT + SOS responder experience (rich SOS detail,
// "I can help", voice note, disclaimer, helper ETA tracking). It is no
// longer in the bottom nav - the ambient people-map is the home ("/") -
// but every SOS deep-link (notifications, pushes, the home SOS banner)
// routes here, so it stays a full, reachable page.
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function MapPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-dark-950 flex items-center justify-center">
          <div className="w-8 h-8 rounded-full border-2 border-primary-500/30 border-t-primary-500 animate-spin" />
        </div>
      }
    >
      <MapClient />
    </Suspense>
  );
}
