// Silent intruder capture for failed LOGIN attempts (wrong password on
// any account). Reuses the admin intruder-alert pipeline that already
// serves the admin PIN gate.
//
// Two hard rules keep this honest and non-disruptive:
//   1. NEVER prompt. If camera permission is not already granted, do
//      nothing. A permission dialog popping up on a failed login would
//      both tip off a thief and harass a fat-fingered owner. In the
//      installed app the permission is usually granted long before
//      (posting, profile photos), so real coverage is high.
//   2. NEVER block or slow the login flow. Fire and forget, every
//      failure swallowed.

export async function captureLoginIntruder(attemptedEmail: string): Promise<void> {
  try {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) return;

    // Only proceed when permission is ALREADY granted (rule 1). Browsers
    // without the Permissions API fall through and try; the getUserMedia
    // prompt risk there is accepted as the rare case.
    try {
      const status = await navigator.permissions.query({ name: "camera" as PermissionName });
      if (status.state !== "granted") return;
    } catch {}

    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user", width: { ideal: 640 } },
      audio: false,
    });

    const video = document.createElement("video");
    video.srcObject = stream;
    video.muted = true;
    video.playsInline = true;
    await video.play().catch(() => {});
    // One breath so the sensor exposes; a black first frame helps nobody.
    await new Promise((r) => setTimeout(r, 350));

    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    canvas.getContext("2d")?.drawImage(video, 0, 0);
    const photo = canvas.toDataURL("image/jpeg", 0.7);

    stream.getTracks().forEach((t) => t.stop());
    video.remove();

    // Best-effort position, short leash: never make the report wait.
    let latitude: number | null = null;
    let longitude: number | null = null;
    try {
      const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          timeout: 2500,
          maximumAge: 60000,
        }),
      );
      latitude = pos.coords.latitude;
      longitude = pos.coords.longitude;
    } catch {}

    // keepalive: survives the page moving on.
    await fetch("/api/admin/intruder-alert", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      keepalive: true,
      body: JSON.stringify({
        photo,
        userEmail: attemptedEmail,
        context: "login_failed",
        latitude,
        longitude,
      }),
    }).catch(() => {});
  } catch {
    // Silence is the contract.
  }
}
