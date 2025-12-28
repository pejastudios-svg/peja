"use client";

import { useEffect, useState } from "react";
import { Post, SOSAlert } from "@/lib/types";
import IncidentMapInner from "./IncidentMapInner";

interface MapWrapperProps {
  posts: Post[];
  userLocation: { lat: number; lng: number } | null;
  onPostClick: (postId: string) => void;
  sosAlerts?: SOSAlert[];
  onSOSClick?: (id: string) => void;
  centerOnUser?: boolean;
  centerOnCoords?: { lat: number; lng: number } | null;
  openSOSId?: string | null;
  compassEnabled?: boolean;
}

export default function MapWrapper(props: MapWrapperProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    return () => setMounted(false);
  }, []);

  if (!mounted) {
    return (
      <div className="h-full flex items-center justify-center bg-dark-800">
        <div className="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return <IncidentMapInner {...props} />;
}