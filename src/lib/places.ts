import { authFetchJson } from "@/lib/authFetch";

// Client helpers for saved places (geofencing phase 1).
//
// Every mutation announces itself on window ("peja-places-changed") so
// surfaces that render places (the home map, the sheet strip) can refetch
// without prop-drilling through unrelated components. The check-in sheet
// and the map live on the same screen, so a place saved in one must
// appear in the other immediately.

function announceChange() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("peja-places-changed"));
  }
}

export type PlaceKind = "home" | "school" | "work" | "lesson" | "custom";

export interface Place {
  id: string;
  owner_user_id: string;
  device_id: string | null;
  label: string;
  kind: PlaceKind;
  lat: number;
  lng: number;
  radius_m: number;
  address_text: string | null;
  visible_to_circle: boolean;
  created_at: string;
  updated_at: string;
}

export const PLACE_KINDS: { kind: PlaceKind; label: string }[] = [
  { kind: "home", label: "Home" },
  { kind: "school", label: "School" },
  { kind: "work", label: "Work" },
  { kind: "lesson", label: "Lesson" },
  { kind: "custom", label: "Other" },
];

export async function fetchPlaces(): Promise<Place[]> {
  const { data } = await authFetchJson("/api/places");
  return (data?.places as Place[]) || [];
}

export async function createPlace(input: {
  label: string;
  kind: PlaceKind;
  lat: number;
  lng: number;
  radiusM: number;
  addressText?: string | null;
  deviceId?: string | null;
  visibleToCircle?: boolean;
}): Promise<Place> {
  const { res, data } = await authFetchJson("/api/places", {
    method: "POST",
    body: JSON.stringify(input),
  });
  if (!res.ok || !data?.ok) throw new Error(data?.error || "Could not save the place");
  announceChange();
  return data.place as Place;
}

export async function updatePlace(
  id: string,
  input: Partial<{
    label: string;
    kind: PlaceKind;
    lat: number;
    lng: number;
    radiusM: number;
    addressText: string | null;
    visibleToCircle: boolean;
  }>,
): Promise<Place> {
  const { res, data } = await authFetchJson(`/api/places/${id}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
  if (!res.ok || !data?.ok) throw new Error(data?.error || "Could not update the place");
  announceChange();
  return data.place as Place;
}

export async function deletePlace(id: string): Promise<void> {
  const { res, data } = await authFetchJson(`/api/places/${id}`, { method: "DELETE" });
  if (!res.ok || !data?.ok) throw new Error(data?.error || "Could not delete the place");
  announceChange();
}
