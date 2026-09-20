"use client";

import { useEffect } from "react";
import { Select } from "./Field";
import { useLocations } from "../../lib/locations";

// A State → LGA pair. The LGA list is derived from the chosen state, so the
// two can never disagree — which is the entire point of replacing four
// free-text boxes with this. Choosing a different state clears an LGA that
// doesn't belong to it rather than quietly submitting a mismatched pair.

export interface StateLgaSelectsProps {
  stateLabel: string;
  lgaLabel: string;
  state: string;
  lga: string;
  onStateChange: (state: string) => void;
  onLgaChange: (lga: string) => void;
  required?: boolean;
  /** id prefixes, so two pairs on one page don't collide. */
  idPrefix?: string;
}

export function StateLgaSelects({
  stateLabel,
  lgaLabel,
  state,
  lga,
  onStateChange,
  onLgaChange,
  required,
  idPrefix,
}: StateLgaSelectsProps) {
  const { states, lgasFor, loaded, error } = useLocations();
  const lgas = lgasFor(state);

  // Clear an LGA left over from a previously chosen state.
  useEffect(() => {
    if (lga && loaded && !lgas.includes(lga)) onLgaChange("");
    // Deliberately not depending on `lgas` — it's a fresh array every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, loaded, lga]);

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Select
        id={idPrefix ? `${idPrefix}-state` : undefined}
        label={stateLabel}
        value={state}
        onChange={(e) => onStateChange(e.target.value)}
        required={required}
        disabled={!loaded}
      >
        <option value="">{loaded ? "Select a state" : "Loading states…"}</option>
        {states.map((s) => (
          <option key={s.state} value={s.state}>
            {s.state}
          </option>
        ))}
      </Select>

      <Select
        id={idPrefix ? `${idPrefix}-lga` : undefined}
        label={lgaLabel}
        value={lga}
        onChange={(e) => onLgaChange(e.target.value)}
        required={required}
        disabled={!state || !loaded}
      >
        <option value="">
          {!loaded ? "Loading LGAs…" : !state ? "Select a state first" : "Select an LGA"}
        </option>
        {lgas.map((l) => (
          <option key={l} value={l}>
            {l}
          </option>
        ))}
      </Select>

      {error && (
        <p className="sm:col-span-2 text-xs text-error">
          {error} Pick from the list once it loads — free-text entries are no longer accepted.
        </p>
      )}
    </div>
  );
}
