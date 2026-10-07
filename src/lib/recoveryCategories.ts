/**
 * The kinds of lockout someone can report, and what you do about each.
 *
 * Shared by the public request form and the admin support screen so the
 * two cannot drift. The user picks a `label`; you read the matching
 * `steps` beside their ticket instead of remembering the process.
 *
 * Every path ends the same way, at Account access on the user's admin
 * page, because that is the only door left. What changes between
 * categories is how you satisfy yourself the person asking is really the
 * account holder, which is the part no code can do for you.
 */
export type RecoveryCategoryId =
  | "no_codes"
  | "lost_codes"
  | "no_contacts"
  | "contacts_unreachable"
  | "lost_email"
  | "other";

export interface RecoveryCategory {
  id: RecoveryCategoryId;
  /** Shown to the locked-out user on the request form. */
  label: string;
  /** One line under the label, in their words not ours. */
  hint: string;
  /** Shown to you, expandable, beside the ticket. */
  steps: string[];
  /** Flags the ones that need more than the usual check before resetting. */
  caution?: string;
}

// Repeated at the end of most paths. Kept in one place so a change to how
// you verify someone changes everywhere at once.
const RESET_STEP =
  "Open Account access on their admin user page, Reset password, and send the temporary password to the email shown there. Never to any address they gave you in the ticket.";

const VERIFY_STEPS = [
  "Start from the amber box above. Nobody signed in to file this, so the account shown is only whose email was typed in. The name and number they gave are checked against the account for you.",
  "Open their profile under Admin, Users. Check the phone number, city and join date against what they told you.",
  "Call one of their accepted emergency contacts and ask whether this person really is locked out. This is the strongest check you have.",
];

export const RECOVERY_CATEGORIES: RecoveryCategory[] = [
  {
    id: "no_codes",
    label: "I never set up recovery codes",
    hint: "You did not save a set of codes when you signed up",
    steps: [
      ...VERIFY_STEPS,
      RESET_STEP,
      "Once they are back in, the app forces them to pick their own password and then prompts them to set up recovery codes. No follow-up needed from you.",
    ],
  },
  {
    id: "lost_codes",
    label: "I had codes but I lost them",
    hint: "You saved them somewhere and cannot find them now",
    steps: [
      ...VERIFY_STEPS,
      RESET_STEP,
      "Tell them to generate a fresh set under Settings, Security. Generating new codes cancels the lost ones, which closes off whoever might have found them.",
    ],
  },
  {
    id: "no_contacts",
    label: "I do not have two emergency contacts",
    hint: "You have fewer than two people who accepted your request",
    steps: [
      "Check their contacts on the admin user page. Pending invites do not count, only accepted ones.",
      "If they have one accepted contact, call that person. One is weaker than two but it is still a real check.",
      "If they have none, verify on the account details alone: phone number, city, join date, and anything they have posted or reported.",
      RESET_STEP,
    ],
    caution: "With no contacts to call, the account details are all you have. Take your time.",
  },
  {
    id: "contacts_unreachable",
    label: "My contacts are not responding",
    hint: "You asked them but nobody confirmed",
    steps: [
      "Call the contacts yourself from their admin user page. People answer a phone call far more often than they act on an app notification.",
      "If one of them confirms over the phone, that is your verification.",
      "If none can be reached, fall back to the account details: phone number, city, join date.",
      RESET_STEP,
    ],
  },
  {
    id: "lost_email",
    label: "I have lost access to my email too",
    hint: "You cannot open the inbox on your peja account",
    steps: [
      "Do not reset yet. The temporary password goes to the email on the account, which is the one they cannot open, so resetting first achieves nothing.",
      "Verify harder than usual, because the normal safety net is gone. Call an emergency contact. Confirm the phone number, city and join date.",
      "Change the email on the account first, in the Supabase dashboard under Authentication, Users.",
      "Then reset and send the temporary password to the new address.",
    ],
    caution:
      "The hardest case. Email is normally what protects this process, and here it is missing. If anything does not add up, stop and ask for more.",
  },
  {
    id: "other",
    label: "Something else",
    hint: "Tell us what happened",
    steps: [
      "Read what they wrote first. It may not be a lockout at all.",
      ...VERIFY_STEPS,
      RESET_STEP,
    ],
  },
];

export function findRecoveryCategory(id: string | null | undefined): RecoveryCategory | null {
  if (!id) return null;
  return RECOVERY_CATEGORIES.find((c) => c.id === id) ?? null;
}
