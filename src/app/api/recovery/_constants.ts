/**
 * Shared knobs for contact-based account recovery.
 *
 * Previously duplicated across start/ and respond/, which is how the two
 * halves of one policy drift apart. status/ needs them too, so that an
 * unknown request id can be answered with the same shape as a pending one
 * instead of a 404 that reveals whether the account exists.
 */

// How many trusted contacts must approve. Two, so that no single person,
// and no single compromised contact account, can take someone's account.
export const APPROVALS_REQUIRED = 2;

// The gap between the last approval and access actually opening. The real
// owner is pushed a cancel link the moment recovery starts, so this window
// is what protects them when the request was not theirs.
export const UNLOCK_DELAY_MIN = 10;
