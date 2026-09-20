"use client";

import { useEffect, useState } from "react";

// Shared shape for GET /v1/config/locations — the 37 states and their 774
// LGAs, sourced from @farmermarket/core on the API. Read from the API rather
// than bundled so the web app can't drift from what the server validates:
// a dropdown offering a spelling the API rejects is a form that can't submit.

export interface StateLgas {
  state: string;
  lgas: string[];
}

const BASE = process.env.NEXT_PUBLIC_API_URL;

// The dataset never changes at runtime, so one fetch per page load is enough
// and every mounted pair of dropdowns shares it.
let cached: StateLgas[] | null = null;
let inflight: Promise<StateLgas[]> | null = null;

export async function fetchLocations(): Promise<StateLgas[]> {
  if (cached) return cached;
  if (!inflight) {
    inflight = fetch(`${BASE}/v1/config/locations`)
      .then(async (res) => {
        if (!res.ok) throw new Error("Failed to load the states and LGAs.");
        const body = (await res.json()) as { states: StateLgas[] };
        cached = body.states;
        return cached;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

export interface Locations {
  states: StateLgas[];
  /** The LGAs of `state`, or [] until it's chosen — drives the cascade. */
  lgasFor: (state: string) => string[];
  loaded: boolean;
  error: string | null;
}

export function useLocations(): Locations {
  const [states, setStates] = useState<StateLgas[]>(cached ?? []);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetchLocations()
      .then((s) => live && setStates(s))
      .catch((err: unknown) =>
        live && setError(err instanceof Error ? err.message : "Failed to load locations."),
      );
    return () => {
      live = false;
    };
  }, []);

  return {
    states,
    lgasFor: (state: string) => states.find((s) => s.state === state)?.lgas ?? [],
    loaded: states.length > 0,
    error,
  };
}
