"use client";

import dynamic from "next/dynamic";
import { Loader2 } from "lucide-react";

// Dynamic import with SSR disabled
const MapWrapper = dynamic(
  () => import("./MapWrapper"),
  {
    ssr: false,
    loading: () => (
      <div className="h-full flex items-center justify-center bg-dark-800">
        <Loader2 className="w-8 h-8 text-primary-500 animate-spin" />
      </div>
    ),
  }
);

export default MapWrapper;