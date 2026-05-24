"use client";

import { Crosshair } from "lucide-react";
import { PejaSpinner } from "@/components/ui/PejaSpinner";

interface ReportLocationRowProps {
  location: {
    latitude: number;
    longitude: number;
    address?: string;
  } | null;
  locationLoading: boolean;
  onGetLocation: () => void;
}

export function ReportLocationRow({
  location,
  locationLoading,
  onGetLocation,
}: ReportLocationRowProps) {
  return (
    <section className="report-section">
      <h2 className="report-section-title">Location</h2>
      <button
        type="button"
        onClick={onGetLocation}
        disabled={locationLoading}
        className="report-list-row"
      >
        <div
          className="report-list-row-icon"
          style={{
            background: location ? "rgba(34, 197, 94, 0.12)" : undefined,
            borderColor: location ? "rgba(34, 197, 94, 0.35)" : undefined,
          }}
        >
          {locationLoading ? (
            <PejaSpinner className="w-5 h-5" />
          ) : (
            <Crosshair className={`w-5 h-5 ${location ? "text-green-400" : "text-primary-500"}`} />
          )}
        </div>
        <div className="flex-1 min-w-0">
          {location ? (
            <>
              <p className="text-sm font-medium text-dark-100 truncate">
                {location.address || "Location captured"}
              </p>
              <p className="text-xs text-dark-500 mt-0.5">
                {location.latitude.toFixed(4)}, {location.longitude.toFixed(4)}
              </p>
            </>
          ) : (
            <>
              <p className="text-sm font-medium text-dark-200">
                {locationLoading ? "Getting location…" : "Use current location"}
              </p>
              <p className="text-xs text-dark-500 mt-0.5">Tap to attach GPS to this report</p>
            </>
          )}
        </div>
        {location && (
          <div
            className="flex items-center gap-1 px-2 py-1 rounded-full shrink-0"
            style={{ background: "rgba(34,197,94,0.12)" }}
          >
            <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse" />
            <span className="text-[10px] text-green-400 font-semibold uppercase tracking-wide">Live</span>
          </div>
        )}
      </button>
    </section>
  );
}
