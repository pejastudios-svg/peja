// Hand off turn-by-turn to the platform's native maps app: Apple Maps on
// iOS (what iPhone users expect), Google Maps everywhere else. Both open
// the installed app on a phone and the website on desktop. Origin omitted
// -> the maps app uses the device's own live location, better than a
// stale fix.

function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  // iPadOS 13+ reports itself as a Mac; the touch check catches it.
  return (
    /iPhone|iPad|iPod/i.test(ua) ||
    (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1)
  );
}

export function openDirections(
  dest: { lat: number; lng: number },
  origin?: { lat: number; lng: number } | null,
) {
  if (isIOS()) {
    // Apple Maps: daddr = destination, saddr = source (omit for "current
    // location"), dirflg=d for driving directions.
    const params = new URLSearchParams({
      daddr: `${dest.lat},${dest.lng}`,
      dirflg: "d",
    });
    if (origin) params.set("saddr", `${origin.lat},${origin.lng}`);
    window.open(`https://maps.apple.com/?${params.toString()}`, "_blank");
    return;
  }

  const params = new URLSearchParams({
    api: "1",
    destination: `${dest.lat},${dest.lng}`,
  });
  if (origin) params.set("origin", `${origin.lat},${origin.lng}`);
  window.open(`https://www.google.com/maps/dir/?${params.toString()}`, "_blank");
}
