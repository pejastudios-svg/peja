"use client";

import { useMemo, useRef } from "react";
import MapGL, { Source, Layer, MapRef } from "react-map-gl/maplibre";
import type { MapLayerMouseEvent } from "react-map-gl/maplibre";
import "maplibre-gl/dist/maplibre-gl.css";
import type { BeaconDevice } from "@/lib/beacon";

// Fleet map: every hosted Beacon with a fix, clustered. A thousand
// students on one campus collapses into a handful of counted circles;
// tapping a cluster zooms in until individual wearers separate. Uses
// MapLibre's native clustering (GeoJSON source), not DOM markers, so the
// device count never becomes a DOM count.

const MAP_STYLE = `https://api.maptiler.com/maps/streets-v2-dark/style.json?key=${process.env.NEXT_PUBLIC_MAPTILER_KEY}`;

export function BeaconFleetMap({
  devices,
  onSelect,
}: {
  devices: BeaconDevice[];
  onSelect: (device: BeaconDevice) => void;
}) {
  const mapRef = useRef<MapRef | null>(null);
  const withFix = useMemo(
    () => devices.filter((d) => d.last_lat != null && d.last_lng != null),
    [devices],
  );

  const geojson = useMemo(
    () => ({
      type: "FeatureCollection" as const,
      features: withFix.map((d) => ({
        type: "Feature" as const,
        properties: {
          id: d.id,
          label: d.wearer_name || d.name || "Beacon",
          color: d.wearer_color || "#8b5cf6",
          online: d.status === "connected",
        },
        geometry: { type: "Point" as const, coordinates: [d.last_lng as number, d.last_lat as number] },
      })),
    }),
    [withFix],
  );

  const initial = useMemo(() => {
    if (withFix.length === 0) return { latitude: 6.5244, longitude: 3.3792, zoom: 10 };
    const lats = withFix.map((d) => d.last_lat as number);
    const lngs = withFix.map((d) => d.last_lng as number);
    return {
      latitude: (Math.min(...lats) + Math.max(...lats)) / 2,
      longitude: (Math.min(...lngs) + Math.max(...lngs)) / 2,
      zoom: 11,
    };
  }, [withFix]);

  const onClick = (e: MapLayerMouseEvent) => {
    const feature = e.features?.[0];
    if (!feature) return;
    const map = mapRef.current?.getMap();
    if (!map) return;
    const clusterId = feature.properties?.cluster_id;
    if (clusterId != null) {
      // Zoom a cluster apart.
      const source = map.getSource("fleet") as any;
      source?.getClusterExpansionZoom(clusterId).then((zoom: number) => {
        const [lng, lat] = (feature.geometry as any).coordinates;
        map.easeTo({ center: [lng, lat], zoom, duration: 500 });
      });
      return;
    }
    const id = feature.properties?.id;
    const device = devices.find((d) => d.id === id);
    if (device) onSelect(device);
  };

  return (
    <div className="h-[420px] rounded-2xl overflow-hidden border border-dark-700">
      <MapGL
        ref={mapRef}
        initialViewState={initial}
        mapStyle={MAP_STYLE}
        attributionControl={false}
        interactiveLayerIds={["fleet-clusters", "fleet-points"]}
        onClick={onClick}
      >
        <Source
          id="fleet"
          type="geojson"
          data={geojson}
          cluster
          clusterMaxZoom={16}
          clusterRadius={44}
        >
          <Layer
            id="fleet-clusters"
            type="circle"
            filter={["has", "point_count"]}
            paint={{
              "circle-color": "#7c3aed",
              "circle-opacity": 0.85,
              "circle-radius": ["step", ["get", "point_count"], 16, 10, 20, 50, 26, 200, 32],
              "circle-stroke-width": 2,
              "circle-stroke-color": "#ffffff",
            }}
          />
          <Layer
            id="fleet-cluster-count"
            type="symbol"
            filter={["has", "point_count"]}
            layout={{
              "text-field": ["get", "point_count_abbreviated"],
              "text-size": 13,
              "text-font": ["Open Sans Bold"],
            }}
            paint={{ "text-color": "#ffffff" }}
          />
          <Layer
            id="fleet-points"
            type="circle"
            filter={["!", ["has", "point_count"]]}
            paint={{
              "circle-color": ["get", "color"],
              "circle-radius": 9,
              "circle-opacity": ["case", ["get", "online"], 1, 0.45],
              "circle-stroke-width": 2,
              "circle-stroke-color": "#ffffff",
            }}
          />
          <Layer
            id="fleet-point-labels"
            type="symbol"
            filter={["!", ["has", "point_count"]]}
            layout={{
              "text-field": ["get", "label"],
              "text-size": 11,
              "text-font": ["Open Sans Semibold"],
              "text-offset": [0, 1.4],
              "text-anchor": "top",
              "text-optional": true,
            }}
            paint={{
              "text-color": "#ffffff",
              "text-halo-color": "#000000",
              "text-halo-width": 1.2,
            }}
          />
        </Source>
      </MapGL>
    </div>
  );
}
