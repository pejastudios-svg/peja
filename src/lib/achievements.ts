// Badge definitions - the single source of truth. The DB only stores
// (user_id, key, unlocked_at). Icons are lucide names resolved where
// rendered so this file stays dependency-free for server use.
//
// Design rule (PEJA_HOME_V2_PLAN.md): badges mark READINESS and HELPING.
// Never streaks, never app-open rewards, never leaderboards.

export interface AchievementDef {
  key: string;
  name: string;
  description: string;
  /** Shown greyed on locked badges - the aspiration line. */
  hint: string;
  /** lucide icon name, resolved in the UI layer. */
  icon: string;
}

export const ACHIEVEMENTS: AchievementDef[] = [
  {
    key: "first_light",
    name: "First Light",
    description: "Profile complete and location on - peja can protect you now.",
    hint: "Complete your profile and turn on location",
    icon: "Sunrise",
  },
  {
    key: "circle_starter",
    name: "Circle Starter",
    description: "Someone's watching out for you.",
    hint: "Get your first community member",
    icon: "UserCheck",
  },
  {
    key: "circle_trust",
    name: "Circle of Trust",
    description: "Five people have your back.",
    hint: "Grow your community to 5 people",
    icon: "Users",
  },
  {
    key: "guardian",
    name: "Guardian",
    description: "You accepted being someone's emergency contact.",
    hint: "Accept an emergency contact request",
    icon: "Shield",
  },
  {
    key: "first_responder",
    name: "First Responder",
    description: "You answered when someone checked on you.",
    hint: "Respond to an Are-you-OK ping",
    icon: "HeartHandshake",
  },
  {
    key: "always_ready",
    name: "Always Ready",
    description: "You set up your first safety check-in.",
    hint: "Start a Share My Location session",
    icon: "MapPin",
  },
  {
    key: "night_watch",
    name: "Night Watch",
    description: "You completed a full check-in session safely.",
    hint: "Finish a Share My Location session",
    icon: "Moon",
  },
  {
    key: "lookout",
    name: "Lookout",
    description: "You reported an incident and warned your community.",
    hint: "Report an incident near you",
    icon: "Megaphone",
  },
  {
    key: "community_builder",
    name: "Community Builder",
    description: "Your community has grown to three or more.",
    hint: "Bring 3 people into your community",
    icon: "Sprout",
  },
];

export const ACHIEVEMENT_BY_KEY = new Map(ACHIEVEMENTS.map((a) => [a.key, a]));
