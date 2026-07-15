// Peja-authored safety tips for the local-pulse story rail. Static pool,
// grouped by category. Each day the rail picks ONE tip from each of
// several categories (date-seeded), so users always see a fresh, varied
// set that rotates every 24 hours - never empty, never repetitive, never
// a doom-scroll (PEJA_HOME_V2_PLAN.md Batch E). Written for Nigeria.

export type TipCategory =
  | "road"
  | "personal"
  | "digital"
  | "home"
  | "emergency"
  | "crowd";

export interface SafetyTip {
  id: string;
  category: TipCategory;
  title: string;
  body: string;
  /** lucide icon name, resolved in the UI. */
  icon: string;
  tone: "violet" | "amber" | "green" | "blue";
}

export const SAFETY_TIPS: SafetyTip[] = [
  // ── Road & transport ──
  {
    id: "checkpoint-night", category: "road", tone: "amber", icon: "ShieldAlert",
    title: "At a checkpoint at night",
    body: "Slow down early, turn on your interior light, keep hands visible, and lower your window only partway. Stay calm and don't argue. If something feels wrong, note the location and share your live location with your circle.",
  },
  {
    id: "okada-safety", category: "road", tone: "green", icon: "Bike",
    title: "Riding an okada or keke",
    body: "Note the plate number and text it to someone before you get on. Sit upright, hold the rail not the rider, and keep your phone in an inside pocket. Agree the price before moving.",
  },
  {
    id: "night-drive", category: "road", tone: "blue", icon: "Car",
    title: "Driving alone at night",
    body: "Keep doors locked and windows up in traffic. Leave space to pull out at every stop. If flagged down in a lonely spot, drive to the nearest fuel station or busy area before stopping.",
  },
  {
    id: "danfo-safety", category: "road", tone: "amber", icon: "Bus",
    title: "Boarding a bus or danfo",
    body: "Avoid near-empty buses at odd hours, and don't board one already full of only men if it feels off. Keep your bag on your lap, phone away, and know your stops so you're never caught unsure.",
  },

  // ── Personal safety ──
  {
    id: "trust-your-gut", category: "personal", tone: "violet", icon: "Compass",
    title: "If a place feels wrong, leave",
    body: "Your instinct is data. If a street, vehicle, or person feels off, change direction, enter a busy shop, or call someone and keep talking. You never owe anyone an explanation for keeping yourself safe.",
  },
  {
    id: "share-before-you-go", category: "personal", tone: "violet", icon: "MapPin",
    title: "Tell someone before you move",
    body: "Heading somewhere new or coming home late? Start a Share My Location check-in so your people know where you are and get alerted if you don't arrive. It takes one tap.",
  },
  {
    id: "walk-aware", category: "personal", tone: "green", icon: "Footprints",
    title: "Walking with awareness",
    body: "Keep one earbud out, walk facing traffic, and stay where there's light and people. Looking up and alert - not buried in your phone - makes you a far less likely target.",
  },
  {
    id: "meet-stranger", category: "personal", tone: "blue", icon: "UserCheck",
    title: "Meeting someone new",
    body: "First meetings go in public, daytime, with someone knowing where you are and when you'll check in. Arrange your own transport there and back so you're never dependent on them to leave.",
  },

  // ── Digital & phone ──
  {
    id: "phone-snatch", category: "digital", tone: "blue", icon: "Smartphone",
    title: "Avoiding phone snatchers",
    body: "Don't walk and text near the road edge or in slow traffic. Keep your phone away at junctions and bus stops. If someone snatches it, let it go - your safety is worth more than any device.",
  },
  {
    id: "otp-scam", category: "digital", tone: "amber", icon: "Lock",
    title: "Never share your OTP",
    body: "No real bank, network, or agency will ever ask for your OTP, PIN, or full card details by call or text. Anyone who does is a scammer. Hang up and verify through the official app or number.",
  },
  {
    id: "lock-phone", category: "digital", tone: "violet", icon: "KeyRound",
    title: "Lock down your phone",
    body: "Use a strong screen lock and turn on Find My Device. Keep transfer apps behind their own PIN or fingerprint, so a stolen phone can't drain your account before you block it.",
  },

  // ── Home & neighbourhood ──
  {
    id: "home-arrival", category: "home", tone: "green", icon: "Home",
    title: "Arriving home safely",
    body: "Have your key ready before you reach the gate so you're not fumbling in the dark. If someone followed you, don't go in - drive or walk past and call a neighbour or your circle.",
  },
  {
    id: "know-neighbours", category: "home", tone: "blue", icon: "Users",
    title: "Know your neighbours",
    body: "The people nearest you are your fastest help in an emergency. Swap numbers with two you trust, and add them to your peja circle so an SOS reaches them in seconds.",
  },

  // ── Emergency prep ──
  {
    id: "emergency-numbers", category: "emergency", tone: "amber", icon: "PhoneCall",
    title: "Know who to reach",
    body: "Save your two closest people as emergency contacts in peja so your SOS reaches them instantly. Add the local police and a trusted neighbour too. In an emergency, seconds matter.",
  },
  {
    id: "charged-ready", category: "emergency", tone: "violet", icon: "BatteryCharging",
    title: "Keep your lifeline charged",
    body: "A dead phone can't call for help. Carry a power bank on long days, keep location on, and know that holding your SOS button alerts your circle even when you can't speak.",
  },

  // ── Crowds & public ──
  {
    id: "crowd-safety", category: "crowd", tone: "blue", icon: "Users",
    title: "In a crowd or protest",
    body: "Stay at the edges, know two ways out, and agree a meeting point with anyone you came with. Keep your phone charged and your live location on. If a crowd surges, move sideways, not against it.",
  },
  {
    id: "market-safety", category: "crowd", tone: "green", icon: "ShoppingBag",
    title: "At a busy market",
    body: "Carry only the cash you need and keep it split across pockets. Wear your bag across your body, zip facing in. Beware anyone crowding you or creating a distraction - that's often the setup.",
  },
];

// Category rotation order - each day the rail draws from these in turn.
const ROTATION: TipCategory[] = ["personal", "road", "digital", "emergency", "home", "crowd"];

/**
 * Deterministic daily rotation: pick `count` tips, one from a different
 * category each, seeded by the day so they stay constant for 24h then
 * refresh. Every device sees the same curated set.
 */
export function tipsForToday(count = 4): SafetyTip[] {
  const day = Math.floor(Date.now() / 86_400_000);
  const byCat = new Map<TipCategory, SafetyTip[]>();
  for (const t of SAFETY_TIPS) {
    (byCat.get(t.category) ?? byCat.set(t.category, []).get(t.category)!).push(t);
  }
  const out: SafetyTip[] = [];
  for (let i = 0; i < count; i++) {
    const cat = ROTATION[(day + i) % ROTATION.length];
    const pool = byCat.get(cat);
    if (pool && pool.length > 0) {
      // Advance within the category each day too, so a category doesn't
      // show the same tip every time it comes up.
      out.push(pool[(day + Math.floor((day + i) / ROTATION.length)) % pool.length]);
    }
  }
  // De-dupe (small pools can collide) and top up if short.
  const seen = new Set(out.map((t) => t.id));
  if (out.length < count) {
    for (const t of SAFETY_TIPS) {
      if (out.length >= count) break;
      if (!seen.has(t.id)) { out.push(t); seen.add(t.id); }
    }
  }
  return out.slice(0, count);
}
