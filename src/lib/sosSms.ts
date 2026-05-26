// Offline SOS path — compose an SMS body and open the device's
// native Messages app pre-filled with the message + recipient phone
// numbers. The SMS is sent via the user's own carrier (so charges
// fall on the user, NOT on Peja — which was a hard requirement).
//
// Platform behavior:
//   - iOS Safari + iOS Capacitor WKWebView: tapping an `sms:` URL
//     opens Messages with the body and recipients pre-filled. User
//     must tap Send. Apple does not allow programmatic auto-send.
//   - Android Chrome + Android Capacitor WebView: same — opens the
//     default SMS app pre-filled. User taps Send. (Android can
//     auto-send via a Capacitor SMS plugin + SEND_SMS permission;
//     that's a future enhancement, not wired here.)
//   - Desktop browsers: most ignore `sms:` URLs. This path is meant
//     for mobile users hitting SOS offline; desktop users with no
//     network are an unusual case we don't optimize for.
//
// Used by SOSButton when navigator.onLine === false.

import { SOS_TAGS } from "./types";
import type { CachedEmergencyContact } from "./emergencyContactsCache";

export interface SosSmsParams {
  userName: string;
  // Accept any string here, not SOSTagId, because SOSButton defines
  // its own local SOSTagId union with the same id strings. We look
  // the label up out of SOS_TAGS at call time anyway.
  tag: string | null;
  message: string | null;
  // Live location captured at SOS press. lat/lng can be null if the
  // device couldn't get a fix at all (rare even offline — Capacitor
  // returns the last cached GPS reading).
  latitude: number | null;
  longitude: number | null;
  // Reverse-geocoded address — null when offline because Nominatim
  // requires network. The SMS body falls back to coords + map link.
  address: string | null;
  contacts: CachedEmergencyContact[];
}

/**
 * Build the SMS body that recipients see. Kept short on purpose —
 * SMS has practical length limits (160 chars per segment; longer
 * messages split across segments and may not arrive in order on bad
 * networks).
 */
export function composeSosSmsBody(params: SosSmsParams): string {
  const { userName, tag, message, latitude, longitude, address } = params;
  const tagInfo = tag ? SOS_TAGS.find((t) => t.id === tag) : null;
  const tagLabel = tagInfo?.label || "Emergency";

  const lines: string[] = [];
  lines.push(`URGENT: ${userName} needs help (${tagLabel}).`);

  if (address) {
    lines.push(address);
  }

  if (latitude != null && longitude != null) {
    // Google Maps URL works as both a deep-link (opens Maps app on
    // mobile when tapped) and a regular link. Short enough to fit
    // comfortably inside a single SMS segment.
    lines.push(`https://maps.google.com/?q=${latitude},${longitude}`);
  }

  if (message && message.trim()) {
    lines.push(`Note: ${message.trim()}`);
  }

  lines.push("Sent via Peja.");
  return lines.join("\n");
}

/**
 * Open the device's SMS app with the body + recipient phone numbers
 * pre-filled. Returns true if we successfully invoked the SMS intent,
 * false if there were no contacts to message or we weren't able to
 * navigate (e.g., desktop browser that refuses sms:).
 */
export function openSosSmsIntent(params: SosSmsParams): boolean {
  if (typeof window === "undefined") return false;
  const recipients = params.contacts
    .map((c) => c.phone.trim())
    .filter((p) => p.length > 0);
  if (recipients.length === 0) return false;

  const body = composeSosSmsBody(params);
  // The `sms:` URL grammar differs slightly between iOS and Android
  // for multi-recipient + body. Android wants comma-separated
  // recipients before the `?`; iOS accepts the same form. The body
  // is in the query string and must be URL-encoded.
  const href = `sms:${recipients.join(",")}?body=${encodeURIComponent(body)}`;

  try {
    // window.location.assign opens the SMS app in both Safari and
    // Android Chrome / Capacitor WebView. We don't use window.open
    // because mobile browsers may block it as a popup.
    window.location.assign(href);
    return true;
  } catch {
    return false;
  }
}
