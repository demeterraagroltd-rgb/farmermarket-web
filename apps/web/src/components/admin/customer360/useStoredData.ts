"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "../../../lib/auth";

export interface StoredData<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  reload: () => void;
}

/**
 * GETs one of the Customer 360 stored-data endpoints. These read what a sync
 * already saved — they never reach Mono — so it is safe to call on mount and on
 * every filter change. Pass `null` to stay idle (e.g. while a form is invalid).
 *
 * The previous result stays on screen while the next one loads, so paging and
 * filtering don't flash the table empty; only the latest request may write
 * state, so a slow earlier response can't overwrite a newer one.
 */
export function useStoredData<T>(path: string | null): StoredData<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(path !== null);
  const [tick, setTick] = useState(0);
  const latest = useRef(0);

  useEffect(() => {
    if (path === null) return;
    const mine = ++latest.current;
    setLoading(true);
    apiFetch(path)
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.message ?? `Couldn't load this data (${res.status})`);
        if (mine !== latest.current) return;
        setData(body as T);
        setError(null);
      })
      .catch((e) => {
        if (mine !== latest.current) return;
        setError(e instanceof Error ? e.message : "Couldn't load this data");
      })
      .finally(() => {
        if (mine === latest.current) setLoading(false);
      });
  }, [path, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, error, loading, reload };
}

/** Download an authenticated CSV as a file (a plain link can't carry the bearer token). */
export async function downloadCsv(path: string, fallbackName: string): Promise<{ rows: number | null; truncated: boolean }> {
  const res = await apiFetch(path);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message ?? `Export failed (${res.status})`);
  }
  const blob = await res.blob();
  const name = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") ?? "")?.[1] ?? fallbackName;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  const rows = Number(res.headers.get("X-Export-Rows"));
  return { rows: Number.isFinite(rows) && res.headers.has("X-Export-Rows") ? rows : null, truncated: res.headers.get("X-Export-Truncated") === "true" };
}
