import type { BroadcastAudience, BroadcastDelivery } from "./broadcastAudience";

/**
 * The fixed calendar of messages peja sends every year.
 *
 * Set once. The cron runs daily, asks "is today one of these", and sends
 * if so. Adding a day means adding an entry here, not a new cron job.
 *
 * Two kinds of entry:
 *
 *   safety  - tied to a real change in risk. Travel seasons, crowd days,
 *             the ember months. These earn their interruption.
 *   warmth  - greetings. Kept few on purpose.
 *
 * Delivery is a safety decision, not a style one. A push body is readable
 * on a lock screen by whoever is standing next to the person, so anything
 * about violence or self-harm is in_app only, where it stays behind the
 * login. See broadcastAudience.ts.
 *
 * Eid is deliberately absent: it follows the moon and cannot be computed,
 * so it would need editing every year and this file is meant to be left
 * alone.
 */

// ---------------------------------------------------------------------
// WHAT THE HEAVY MESSAGES POINT AT
// ---------------------------------------------------------------------
// Messages about self-harm are not sent while this is blank. "Today is
// Suicide Prevention Day" with nothing attached is an interruption rather
// than help.
//
// Deliberately NOT a third-party crisis line. Printing someone else's
// number inside peja quietly makes peja answerable for it: if it has
// moved, closed, or nobody picks up, the person in trouble experiences
// that as peja failing them. Keeping it in-house means what we point at
// is something we actually control.
//
// So it points at emergency contacts, which is both the honest answer and
// the one peja can keep working: the people on that list are already
// chosen, already trusted, and already one tap away.
export const SUICIDE_PREVENTION_RESOURCE =
  "Your emergency contacts are people you already trust. Open Settings, then Your Community, to reach one of them.";

// ---------------------------------------------------------------------

export interface Milestone {
  /** Stable across years. Combined with the year for the send-once guard. */
  key: string;
  title: string;
  body: string;
  /** Shown under the body. A number, a link, something usable. */
  resourceText?: string;
  delivery: BroadcastDelivery;
  audience?: BroadcastAudience;
  /** Refuses to send while resourceText is empty. */
  requiresResource?: boolean;
  /** Fixed calendar date. */
  month?: number; // 1-12
  day?: number;
  /** Or worked out per year, for the ones that move. */
  computeDate?: (year: number) => { month: number; day: number };
}

/** Anonymous Gregorian computus. Easter Sunday for a given year. */
function easterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

function offsetFromEaster(year: number, days: number) {
  const d = easterSunday(year);
  d.setUTCDate(d.getUTCDate() + days);
  return { month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

/** The nth given weekday of a month, e.g. the 3rd Sunday of June. */
function nthWeekday(year: number, month: number, weekday: number, n: number) {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const shift = (weekday - first.getUTCDay() + 7) % 7;
  return { month, day: 1 + shift + (n - 1) * 7 };
}

export const MILESTONES: Milestone[] = [
  // ---------- Warmth ----------
  {
    key: "new-year",
    month: 1,
    day: 1,
    title: "Happy New Year",
    body: "A new year from all of us at peja. However this year goes, you are not walking it alone.",
    delivery: "push",
  },
  {
    key: "childrens-day",
    month: 5,
    day: 27,
    title: "Happy Children's Day",
    body: "To every child, and everyone keeping one safe today. Enjoy the day.",
    delivery: "push",
  },
  {
    key: "friendship-day",
    month: 7,
    day: 30,
    title: "Day of Friendship",
    body: "Your people are the ones who come when it matters. Check that the ones you trust are on your emergency contacts list.",
    resourceText: "Settings, then Your Community, to see who is on your list.",
    delivery: "push",
  },
  {
    key: "mothers-day",
    computeDate: (y) => offsetFromEaster(y, -21),
    title: "Happy Mother's Day",
    body: "To every mother and everyone who mothers. Thank you for the watching you do.",
    delivery: "push",
  },
  {
    key: "fathers-day",
    computeDate: (y) => nthWeekday(y, 6, 0, 3),
    title: "Happy Father's Day",
    body: "To every father and everyone who stands in. Thank you for the watching you do.",
    delivery: "push",
  },
  {
    key: "good-friday",
    computeDate: (y) => offsetFromEaster(y, -2),
    title: "Travelling this Easter?",
    body: "The roads are at their busiest. Tell someone your route before you set off, and keep Share My Location on while you move.",
    resourceText: "Hold SOS any time you need help.",
    delivery: "push",
  },

  // ---------- Safety ----------
  {
    key: "armed-forces-remembrance",
    month: 1,
    day: 15,
    title: "Armed Forces Remembrance Day",
    body: "Remembering those who did not come home, and the families still carrying it.",
    delivery: "push",
  },
  {
    key: "valentines",
    month: 2,
    day: 14,
    title: "Meeting someone today?",
    body: "Meet somewhere public, tell a friend where you are going, and keep Share My Location on until you are home. No need to explain it to anyone.",
    resourceText: "Share My Location is on the main screen.",
    delivery: "push",
  },
  {
    key: "womens-day",
    month: 3,
    day: 8,
    title: "International Women's Day",
    body: "Peja exists because getting home safely should not be a daily calculation. Today and every day.",
    delivery: "push",
  },
  {
    key: "workers-day",
    month: 5,
    day: 1,
    title: "Workers' Day",
    body: "A public holiday means fuller roads and busier parks. If you are travelling, let someone know your route.",
    delivery: "push",
  },
  {
    key: "democracy-day",
    month: 6,
    day: 12,
    title: "Democracy Day",
    body: "Crowds and gatherings today. If you are out, keep your people updated and report anything you see on the map.",
    delivery: "push",
  },
  {
    key: "elder-abuse-awareness",
    month: 6,
    day: 15,
    title: "Looking out for older people",
    body: "Older relatives are often the least likely to ask for help. Check in on one today, and make sure they know how to reach you.",
    delivery: "push",
  },
  {
    key: "suicide-prevention",
    month: 9,
    day: 10,
    title: "If today is heavy",
    body: "Some days are harder than others, and reaching out is not weakness. If you are struggling, please talk to someone.",
    resourceText: SUICIDE_PREVENTION_RESOURCE,
    requiresResource: true,
    // In-app only. A lock-screen message on this subject can be read by
    // whoever is near the phone, and that is not the person's choice to
    // make for them.
    delivery: "in_app",
  },
  {
    key: "independence-day",
    month: 10,
    day: 1,
    title: "Happy Independence Day",
    body: "Celebrations mean crowds. Keep your phone charged, keep your people posted, and report anything you see so others can avoid it.",
    delivery: "push",
  },
  {
    key: "mental-health-day",
    month: 10,
    day: 10,
    title: "World Mental Health Day",
    body: "Safety is not only about what happens on the street. Check in on someone today, and let someone check in on you.",
    delivery: "push",
  },
  {
    key: "girl-child-day",
    month: 10,
    day: 11,
    title: "Day of the Girl Child",
    body: "Every girl deserves to move through her day without fear. Thank you for being part of a community that watches out.",
    delivery: "push",
  },
  {
    key: "ember-months",
    month: 11,
    day: 1,
    title: "The ember months are here",
    body: "Robbery and road accidents climb every year from now until January. Travel in daylight where you can, keep Share My Location on, and report what you see so your neighbours know.",
    resourceText: "Hold SOS any time you need help.",
    delivery: "push",
  },
  {
    key: "road-traffic-victims",
    computeDate: (y) => nthWeekday(y, 11, 0, 3),
    title: "Remembering road traffic victims",
    body: "Nigeria loses thousands on the roads every year, most of it in the months ahead. Keep someone updated when you travel.",
    delivery: "push",
  },
  {
    key: "end-violence-against-women",
    month: 11,
    day: 25,
    title: "Ending violence against women",
    body: "If someone is hurting you, it is not your fault and you are not stuck. Your emergency contacts can be anyone you trust, and they are the first people peja reaches when you hold SOS.",
    resourceText: "Settings, then Your Community, to choose who peja contacts for you.",
    // In-app only, and this is the clearest case for it. A notification on
    // this subject appearing on a lock screen could be read by exactly the
    // person the message is about.
    delivery: "in_app",
  },
  {
    key: "human-rights-day",
    month: 12,
    day: 10,
    title: "Human Rights Day",
    body: "Safety is a right, not a favour. Thank you for the reports and confirmations that make this community work.",
    delivery: "push",
  },
  {
    key: "christmas",
    month: 12,
    day: 24,
    title: "Travelling for Christmas?",
    body: "The busiest travel days of the year. Go in daylight if you can, tell someone your route, and keep Share My Location on until you arrive.",
    resourceText: "Hold SOS any time you need help.",
    delivery: "push",
  },
  {
    key: "new-years-eve",
    month: 12,
    day: 31,
    title: "Out tonight?",
    body: "Tonight is the busiest night of the year for peja. Keep your phone charged, stay with people you know, and make sure someone can see where you are.",
    resourceText: "Hold SOS any time you need help.",
    delivery: "push",
  },
];

/** Today in Lagos, so the calendar does not drift by a day on a UTC host. */
export function lagosToday(now: Date = new Date()): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Lagos",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return { year: get("year"), month: get("month"), day: get("day") };
}

export function milestonesFor(year: number, month: number, day: number): Milestone[] {
  return MILESTONES.filter((m) => {
    const date = m.computeDate ? m.computeDate(year) : { month: m.month!, day: m.day! };
    return date.month === month && date.day === day;
  });
}
