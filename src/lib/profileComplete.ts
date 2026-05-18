import type { User } from "@/lib/types";

/**
 * Fields a user must fill in before they can post, comment, or apply as
 * Guardian. Safety features (SOS, alerts, map, emergency contacts, Safety
 * Check-In, messaging) stay accessible regardless — we never gate flows that
 * matter in an emergency.
 *
 * Single source of truth; UI surfaces use the returned `missing` list to tell
 * the user exactly what's left.
 */
export const REQUIRED_PROFILE_FIELDS = [
  { key: "avatar_url", label: "Profile picture" },
  { key: "full_name", label: "Full name" },
  { key: "phone", label: "Phone number" },
  { key: "occupation", label: "Occupation" },
  { key: "date_of_birth", label: "Date of birth" },
  { key: "home_address", label: "Home address" },
] as const;

export type ProfileRequirementKey = (typeof REQUIRED_PROFILE_FIELDS)[number]["key"];

export interface ProfileCompletion {
  complete: boolean;
  missing: { key: ProfileRequirementKey; label: string }[];
}

function isFilled(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

export function profileCompletion(user: User | null | undefined): ProfileCompletion {
  if (!user) return { complete: false, missing: REQUIRED_PROFILE_FIELDS.map((f) => ({ ...f })) };
  const missing: ProfileCompletion["missing"] = [];
  for (const field of REQUIRED_PROFILE_FIELDS) {
    if (!isFilled((user as any)[field.key])) {
      missing.push({ key: field.key, label: field.label });
    }
  }
  return { complete: missing.length === 0, missing };
}

export function isProfileComplete(user: User | null | undefined): boolean {
  return profileCompletion(user).complete;
}
