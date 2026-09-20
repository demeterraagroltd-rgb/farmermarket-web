import { STATES_AND_LGAS, type StateLgas } from "./data.js";

export { STATES_AND_LGAS, type StateLgas };

// Everything here is case- and whitespace-insensitive on the way in and
// canonical on the way out. That is the whole point of the dataset: a form
// that lets someone type "abuja municipal", "AMAC" or "Abuja Municipal Area
// Council" produces three different strings for one place, and no later
// query can group by it. Accepting loose input but storing only the official
// spelling keeps old records readable without reintroducing the ambiguity.

const norm = (s: string): string => s.trim().toLowerCase().replace(/\s+/g, " ");

/** Canonical state name → canonical LGA names, plus a lookup on normalised form. */
const BY_STATE = new Map<string, readonly string[]>();
const STATE_BY_NORM = new Map<string, string>();
const LGA_BY_NORM = new Map<string, Map<string, string>>();

for (const entry of STATES_AND_LGAS) {
  BY_STATE.set(entry.state, entry.lgas);
  STATE_BY_NORM.set(norm(entry.state), entry.state);
  const lgas = new Map<string, string>();
  for (const lga of entry.lgas) lgas.set(norm(lga), lga);
  LGA_BY_NORM.set(entry.state, lgas);
}

/** All 37 state names (36 states + FCT), in alphabetical order. */
export const STATE_NAMES: readonly string[] = STATES_AND_LGAS.map((s) => s.state);

/**
 * The official spelling of a state, or null when it isn't one. Use this to
 * normalise user input before storing it — never store the raw string.
 */
export function canonicalState(input: string | null | undefined): string | null {
  if (!input) return null;
  return STATE_BY_NORM.get(norm(input)) ?? null;
}

/**
 * The LGAs of a state, or an empty array when the state is unknown. Callers
 * building a cascading dropdown should treat empty as "pick a state first".
 */
export function lgasForState(state: string | null | undefined): readonly string[] {
  if (!state) return [];
  const canonical = canonicalState(state);
  return canonical ? (BY_STATE.get(canonical) ?? []) : [];
}

/**
 * The official spelling of an LGA within a state, or null when the pair isn't
 * valid. Checks the LGA against *that state's* list only — several LGA names
 * recur across states, so validating against a flat set would accept a
 * plausible-looking but wrong pairing.
 */
export function canonicalLga(
  state: string | null | undefined,
  lga: string | null | undefined,
): string | null {
  if (!state || !lga) return null;
  const canonical = canonicalState(state);
  if (!canonical) return null;
  return LGA_BY_NORM.get(canonical)?.get(norm(lga)) ?? null;
}

export function isValidStateLgaPair(
  state: string | null | undefined,
  lga: string | null | undefined,
): boolean {
  return canonicalLga(state, lga) !== null;
}
