"use client";

import { useEffect, useState } from "react";

// The collection points a buyer can choose at checkout — GET /v1/pickup-centers,
// which returns the active ones. Farmer Market doesn't deliver to a street
// address, so this list *is* the "where do I get my goods" answer.
export interface PickupCenter {
  id: string;
  name: string;
  address: string;
  isActive: boolean;
}

const BASE = process.env.NEXT_PUBLIC_API_URL;

export async function fetchPickupCenters(): Promise<PickupCenter[]> {
  const res = await fetch(`${BASE}/v1/pickup-centers`);
  if (!res.ok) throw new Error("Failed to load the pickup centres.");
  return (await res.json()) as PickupCenter[];
}

/** `centers` is null while loading, [] once loaded and empty. */
export function usePickupCenters(): { centers: PickupCenter[] | null; error: string | null } {
  const [centers, setCenters] = useState<PickupCenter[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetchPickupCenters()
      .then((rows) => live && setCenters(rows))
      .catch((err: unknown) =>
        live && setError(err instanceof Error ? err.message : "Failed to load the pickup centres."),
      );
    return () => {
      live = false;
    };
  }, []);

  return { centers, error };
}
