"use client";

import dynamic from "next/dynamic";
import { Loader2 } from "lucide-react";

// Dynamic import with SSR disabled - Now using MapLibre GL
const IncidentMapGL = dynamic(
  () => import("./IncidentMapGL"),
  {
    ssr: false,
    loading: () => (
      <div className="h-full flex items-center justify-center bg-dark-800">
        <Loader2 className="w-8 h-8 text-primary-500 animate-spin" />
      </div>
    ),
  }
);

export default IncidentMapGL;