import { NIGERIA_LGAS, NIGERIA_STATES_LIST } from "./nigeriaLgas";

/**
 * Turn what a geocoder calls a place into what our own lists call it.
 *
 * MapTiler returns the state as `subregion` and the LGA as
 * `joint_municipality`, but the spellings do not always line up:
 * "Federal Capital Territory" for FCT, "Municipal Area Council" for
 * Abuja Municipal, "Port-Harcourt" with a hyphen we do not use. So this
 * normalises, then tries aliases, then a prefix, then a small edit
 * distance, and returns null rather than guessing when nothing is close.
 *
 * A wrong area silently assigned is worse than an empty dropdown: it
 * would sell somebody a placement in the wrong LGA.
 */
const norm = (v: string) =>
  v.toLowerCase().replace(/[^a-z0-9]+/g, "");

const STATE_ALIASES: Record<string, string> = {
  federalcapitalterritory: "FCT",
  abujafederalcapitalterritory: "FCT",
  abuja: "FCT",
  nassarawa: "Nasarawa",
  akwaibomstate: "Akwa Ibom",
};

const LGA_ALIASES: Record<string, string> = {
  municipalareacouncil: "Abuja Municipal",
  amac: "Abuja Municipal",
  egbadonorth: "Yewa North",
  egbadosouth: "Yewa South",
};

function lev(a: string, b: string): number {
  const m = a.length, n = b.length;
  const d: number[][] = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 1; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[m][n];
}

function closest(want: string, pool: string[], maxDistance = 2): string | null {
  const w = norm(want);
  if (!w) return null;
  const exact = pool.find((p) => norm(p) === w);
  if (exact) return exact;
  const prefix = pool.find((p) => norm(p).startsWith(w) || w.startsWith(norm(p)));
  if (prefix) return prefix;
  let best: string | null = null;
  let bd = Infinity;
  for (const p of pool) {
    const d = lev(norm(p), w);
    if (d < bd) { bd = d; best = p; }
  }
  return bd <= maxDistance ? best : null;
}

export function matchState(raw?: string | null): string | null {
  if (!raw) return null;
  const alias = STATE_ALIASES[norm(raw)];
  if (alias) return alias;
  return closest(raw, NIGERIA_STATES_LIST);
}

export function matchLga(state: string, raw?: string | null): string | null {
  if (!raw) return null;
  const pool = NIGERIA_LGAS[state] || [];
  const alias = LGA_ALIASES[norm(raw)];
  if (alias && pool.includes(alias)) return alias;
  return closest(raw, pool);
}

/** Pull state and LGA out of a MapTiler geocoding feature's context. */
export function areaFromGeocode(
  context: Array<{ id?: string; text?: string }> | undefined,
): { state: string | null; lga: string | null } {
  const by: Record<string, string> = {};
  for (const c of context || []) {
    const key = (c.id || "").split(".")[0];
    if (key && c.text) by[key] = c.text;
  }
  const state = matchState(by.subregion || by.region);
  const lga = state
    ? matchLga(state, by.joint_municipality || by.municipality || by.county)
    : null;
  return { state, lga };
}
