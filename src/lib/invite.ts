// Community invite links + messages. The invite is deliberately NOT
// "download my app" - it's "someone trusts you with their safety",
// which lands as an honor and an obligation, not an ad.

const APP_URL = "https://peja.life";

export function inviteLink(userId: string): string {
  return `${APP_URL}/join?ref=${encodeURIComponent(userId)}`;
}

export function inviteMessage(name: string, userId: string): string {
  return (
    `${name} wants you as their emergency contact on peja. ` +
    `If they're ever in danger, you're one of the people they trust to know first. ` +
    `Join their circle: ${inviteLink(userId)}`
  );
}

/** WhatsApp deep link with the prefilled message. */
export function whatsappInviteUrl(name: string, userId: string): string {
  return `https://wa.me/?text=${encodeURIComponent(inviteMessage(name, userId))}`;
}

/** SMS compose link. `?&body=` form works across iOS and Android. */
export function smsInviteUrl(name: string, userId: string): string {
  return `sms:?&body=${encodeURIComponent(inviteMessage(name, userId))}`;
}

/** Native share sheet (covers Instagram, Telegram, X, email, everything
 *  installed). Returns false when the platform has no share sheet so the
 *  caller can fall back to copy. */
export async function nativeShareInvite(name: string, userId: string): Promise<boolean> {
  if (!navigator.share) return false;
  try {
    await navigator.share({
      title: "Join my circle on peja",
      text: inviteMessage(name, userId),
    });
    return true;
  } catch {
    // user closed the sheet - still counts as handled
    return true;
  }
}

export async function copyInvite(name: string, userId: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(inviteMessage(name, userId));
    return true;
  } catch {
    return false;
  }
}

// localStorage key holding a pending referral (set by /join for logged-out
// visitors, consumed after signup by CommunityNudge on the home screen).
export const INVITE_REF_KEY = "peja-invite-ref";
