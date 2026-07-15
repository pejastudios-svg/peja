// Hand off turn-by-turn to Google Maps (universal URL: opens the app on
// phones, the website on desktop). Origin omitted -> Google uses the
// device's own live location, which is better than a stale fix.

export function openDirections(
  dest: { lat: number; lng: number },
  origin?: { lat: number; lng: number } | null,
) {
  const params = new URLSearchParams({
    api: "1",
    destination: `${dest.lat},${dest.lng}`,
  });
  if (origin) params.set("origin", `${origin.lat},${origin.lng}`);
  window.open(`https://www.google.com/maps/dir/?${params.toString()}`, "_blank");
}
