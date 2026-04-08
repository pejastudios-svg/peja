"use client";

import dynamic from "next/dynamic";
import { Loader2 } from "lucide-react";
import { PejaSpinner } from "../ui/PejaSpinner";

// Dynamic import with SSR disabled - Now using MapLibre GL
const IncidentMapGL = dynamic(
  () => import("./IncidentMapGL"),
  {
    ssr: false,
    loading: () => (
      <div className="h-full flex items-center justify-center bg-dark-800">
        <PejaSpinner className="w-8 h-8" />
      </div>
    ),
  }
);

export default IncidentMapGL;