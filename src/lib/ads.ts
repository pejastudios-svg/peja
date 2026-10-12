/**
 * Advertising: tiers, policy and presets.
 *
 * Client-safe. No database access, no secrets. Shared by the signup form,
 * the admin review screen and the serving code so that a rule written
 * once is enforced everywhere.
 */

export type AdTier = "listed" | "promoted" | "featured";

export interface TierSpec {
  id: AdTier;
  name: string;
  priceNaira: number;
  /** One line on the chooser. */
  summary: string;
  includes: string[];
  /** Featured requires banner text and a gradient. */
  needsBanner: boolean;
  /** Promoted and above show the advertiser's logo. */
  needsLogo: boolean;
}

/**
 * Three tiers, priced so the middle one is the obvious answer.
 *
 * Promoted costs 2.2x Listed but adds search, which is intent rather than
 * impression and worth several times a passive pin. Featured is 2.7x
 * Promoted for roughly double the exposure, so it reads as the premium
 * buy rather than the sensible one. Listed exists mostly to make Promoted
 * look correct, and to give a shop with no budget a way in.
 */
/**
 * Master switch for everything advertising.
 *
 * Off unless NEXT_PUBLIC_ADS_ENABLED is exactly "1". Default-off on
 * purpose: a flag that defaults on is one missing variable away from
 * showing a half-finished product to everybody, and the failure is
 * silent. This way a mistake hides the feature instead of leaking it.
 *
 * Covers the reader-facing surfaces and the buying flow. The admin
 * review screens stay reachable, because that is where the existing
 * placements are inspected and they are behind the admin gate anyway.
 */
export const adsEnabled = (): boolean =>
  process.env.NEXT_PUBLIC_ADS_ENABLED === "1";

export const AD_TIERS: TierSpec[] = [
  {
    id: "listed",
    name: "Listed",
    priceNaira: 25_000,
    summary: "Your business on the map",
    includes: [
      "A pin at your exact location",
      "Your details when someone taps it",
      "Your socials and directions",
    ],
    needsBanner: false,
    needsLogo: false,
  },
  {
    id: "promoted",
    name: "Promoted",
    priceNaira: 55_000,
    summary: "On the map, and in search",
    includes: [
      "Everything in Listed",
      "You appear when people search your category nearby",
      // Not "your logo on your map pin". Every pin is a muted
      // building-type icon by design, with the logo shown only once
      // somebody taps it, and the pin component is not even told which
      // tier it is drawing. That bullet was selling something the map
      // does not do.
      "Your pin shown about twice as often as Listed",
    ],
    needsBanner: false,
    needsLogo: true,
  },
  {
    id: "featured",
    name: "Featured",
    priceNaira: 150_000,
    summary: "Top of search, and the carousel",
    includes: [
      "Everything in Promoted",
      "A slide in the search carousel",
      // "Top position" was a promise we cannot keep to two Featured
      // advertisers in one niche: between them the order is the session
      // rotation, so each gets the top slot for roughly half of readers.
      // What is always true is that both sit above every Promoted result.
      "Above every Promoted result in search",
      "Your pin shown about three times as often as Listed",
    ],
    needsBanner: true,
    needsLogo: true,
  },
];

export const tierSpec = (id: AdTier) => AD_TIERS.find((t) => t.id === id)!;

/**
 * What peja will not carry.
 *
 * This list is the difference between a safety map and a betting app.
 * The first three categories will reliably be the highest bidders, which
 * is exactly why they are written down rather than decided case by case
 * at the moment someone offers money.
 */
export const PROHIBITED_CATEGORIES = [
  "Betting, gambling, lottery or casino",
  "Loan apps, moneylending or quick cash",
  "Crypto, forex, or anything promising investment returns",
  "Unlicensed health claims, herbal cures or unapproved drugs",
  "Spiritual or miracle services charging money",
  "Multi-level marketing or network marketing",
  "Weapons",
  "Tobacco and vaping",
  "Adult content",
  "Political parties, candidates or campaigns",
] as const;

/**
 * Pin shapes. Deliberately ordinary building types: a map reads these as
 * landmarks, which is the whole point. An ad that looks like map furniture
 * does not feel like an ad.
 *
 * Written for what is actually on a Lagos street rather than a generic
 * list. "Something else" was carrying tailors, mechanics, laundries, POS
 * stands and phone repairers between them, which meant most of the map
 * would have ended up as unlabelled pins.
 */
export const BUILDING_TYPES = [
  { id: "shop", label: "Shop" },
  { id: "supermarket", label: "Supermarket" },
  { id: "cafe", label: "Restaurant" },
  { id: "bakery", label: "Bakery" },
  { id: "pharmacy", label: "Pharmacy" },
  { id: "clinic", label: "Clinic" },
  { id: "salon", label: "Salon" },
  { id: "tailor", label: "Tailor" },
  { id: "mechanic", label: "Mechanic" },
  { id: "laundry", label: "Laundry" },
  { id: "electronics", label: "Phones & tech" },
  { id: "hardware", label: "Hardware" },
  { id: "bank", label: "Bank or POS" },
  { id: "fuel", label: "Filling station" },
  { id: "hotel", label: "Hotel" },
  { id: "events", label: "Event centre" },
  { id: "gym", label: "Gym" },
  { id: "school", label: "School" },
  { id: "office", label: "Office" },
  { id: "market", label: "Market stall" },
  { id: "other", label: "Something else" },
] as const;

export type BuildingType = (typeof BUILDING_TYPES)[number]["id"];

/**
 * What people actually type, mapped to the kind of place it means.
 *
 * Nobody searches "cafe" for lunch, they search "food". Nobody searches
 * "electronics", they search "phone". Without this, a restaurant that
 * paid for Promoted never appears for the most common query there is,
 * and the advertiser concludes search does not work, because for them
 * it did not.
 *
 * Deliberately short. These are synonyms, not a taxonomy: every entry
 * has to be a word somebody would plausibly type into a search box in
 * Lagos, and anything vaguer than that starts matching the wrong shops.
 */
export const SEARCH_SYNONYMS: Record<string, string[]> = {
  cafe: ["food", "restaurant", "eat", "buka", "mama put", "amala", "rice", "suya", "canteen"],
  bakery: ["bread", "cake", "pastry", "confectionery"],
  pharmacy: ["chemist", "drugs", "medicine", "drug store"],
  clinic: ["hospital", "doctor", "nurse", "lab", "dentist", "health"],
  salon: ["barber", "barbing", "hair", "braids", "wig", "nails", "spa", "beauty"],
  tailor: ["sewing", "fashion", "designer", "ankara", "seamstress"],
  mechanic: ["car repair", "panel beater", "vulcanizer", "auto", "spare parts"],
  laundry: ["dry cleaning", "dry cleaner", "washing", "wash"],
  electronics: ["phone", "phones", "laptop", "computer", "charger", "accessories", "gadget", "tech", "repair"],
  hardware: ["cement", "paint", "plumbing", "building materials", "tools", "nails", "pipes"],
  bank: ["pos", "atm", "cash", "transfer", "withdraw", "agent"],
  fuel: ["petrol", "filling station", "diesel", "gas", "kerosene"],
  hotel: ["lodge", "guest house", "accommodation", "room", "shortlet"],
  events: ["hall", "event centre", "event center", "party", "wedding", "reception"],
  gym: ["fitness", "workout", "weights"],
  school: ["lesson", "tutorial", "creche", "nursery", "primary", "secondary", "academy"],
  supermarket: ["provisions", "groceries", "grocery", "mall", "store"],
  market: ["stall", "trader", "wholesale"],
  shop: ["store", "kiosk", "boutique"],
};

/** The words that should match a placement of this kind of place. */
export function searchTermsFor(buildingType: string | null | undefined): string[] {
  if (!buildingType) return [];
  const label = BUILDING_TYPES.find((b) => b.id === buildingType)?.label || "";
  return [buildingType, label, ...(SEARCH_SYNONYMS[buildingType] || [])];
}

/**
 * Featured banner backgrounds.
 *
 * Every banner also carries a one-pixel outline in the app's own border
 * colour, which is dark in light mode and light in dark mode. That single
 * rule means any gradient separates cleanly from the page in both themes,
 * with no per-colour special cases to maintain.
 */
export const BANNER_GRADIENTS = [
  { id: "violet", label: "Violet", css: "linear-gradient(135deg,#7c3aed,#a855f7)" },
  { id: "ocean", label: "Ocean", css: "linear-gradient(135deg,#0ea5e9,#2563eb)" },
  { id: "forest", label: "Forest", css: "linear-gradient(135deg,#059669,#15803d)" },
  { id: "sunset", label: "Sunset", css: "linear-gradient(135deg,#f97316,#db2777)" },
  { id: "gold", label: "Gold", css: "linear-gradient(135deg,#f59e0b,#d97706)" },
  { id: "rose", label: "Rose", css: "linear-gradient(135deg,#e11d48,#be123c)" },
  { id: "slate", label: "Slate", css: "linear-gradient(135deg,#334155,#0f172a)" },
  { id: "teal", label: "Teal", css: "linear-gradient(135deg,#0d9488,#0f766e)" },
] as const;

export const gradientCss = (id?: string | null) =>
  BANNER_GRADIENTS.find((g) => g.id === id)?.css ?? BANNER_GRADIENTS[0].css;

/**
 * How many placements can be sold in one LGA.
 *
 * Listed is generous because pins rotate: only two are ever on screen at
 * once however many are sold, so the map cannot get crowded. Featured is
 * tight because a carousel someone sits through has maybe five slides in
 * it, and a slot shared by hundreds is a slot worth nothing.
 */
export const DEFAULT_AREA_CAPS: Record<AdTier, number> = {
  listed: 200,
  promoted: 60,
  featured: 12,
};

/** Only ever two sponsored pins on screen, whatever has been sold. */
export const MAX_PINS_PER_VIEWPORT = 2;

/** Two pins closer than this would overlap, so only one of them shows. */
export const PIN_DEDUPE_METRES = 100;

/** Deposit to hold a place in the queue, refundable until the balance is taken. */
export const QUEUE_DEPOSIT_PERCENT = 25;

export const queueDeposit = (tier: AdTier) =>
  Math.round((tierSpec(tier).priceNaira * QUEUE_DEPOSIT_PERCENT) / 100);

export const formatNaira = (n: number) => `₦${n.toLocaleString()}`;
