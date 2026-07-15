import { useCallback, useEffect, useMemo, useState } from "react";
import { pushRecent, toggleFavourite } from "@/lib/commandPalette";

/**
 * useRadiologyPalettePrefs — the command palette's lightweight personalization:
 * recently-run items (last 10) and ⭐ favourites, kept in localStorage.
 *
 * Deliberately client-side so the palette stays instant with zero backend calls
 * (PR #77 Part 8) and needs no new table/migration/API. The pure list ops live
 * in lib/commandPalette; this hook only owns React state + persistence.
 */

const RECENT_KEY = "radiology.palette.recent.v1";
const FAV_KEY = "radiology.palette.favourites.v1";

function load(key: string): string[] {
  try {
    if (typeof localStorage === "undefined") return [];
    const v = JSON.parse(localStorage.getItem(key) ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function save(key: string, value: string[]): void {
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode / quota — recents are best-effort, never fatal */
  }
}

export function useRadiologyPalettePrefs() {
  const [recent, setRecent] = useState<string[]>(() => load(RECENT_KEY));
  const [favouriteList, setFavouriteList] = useState<string[]>(() => load(FAV_KEY));

  useEffect(() => { save(RECENT_KEY, recent); }, [recent]);
  useEffect(() => { save(FAV_KEY, favouriteList); }, [favouriteList]);

  const markRecent = useCallback((id: string) => setRecent((r) => pushRecent(r, id)), []);
  const toggleFav = useCallback((id: string) => setFavouriteList((f) => toggleFavourite(f, id)), []);
  const favourites = useMemo(() => new Set(favouriteList), [favouriteList]);

  return { recent, favourites, markRecent, toggleFav };
}
