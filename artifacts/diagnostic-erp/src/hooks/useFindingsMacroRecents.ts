import { useCallback, useEffect, useState } from "react";
import { pushRecent } from "../lib/commandPalette";

/**
 * Recently used Chocolate Box tiles + template macros (findings column).
 * Client-only localStorage — same pattern as useRadiologyPalettePrefs.
 *
 * Use relative imports so root Vitest (no @/ alias) can load this module.
 */

const RECENT_KEY = "radiology.findings.macro_recent.v1";
const MAX = 8;

function load(): string[] {
  try {
    if (typeof localStorage === "undefined") return [];
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function save(value: string[]): void {
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(RECENT_KEY, JSON.stringify(value));
  } catch {
    /* private mode / quota — best-effort */
  }
}

export function chocolateMacroId(setKey: string, label: string): string {
  return `choc:${setKey}:${label}`;
}

export function templateMacroId(key: string): string {
  return `tpl:${key}`;
}

export function useFindingsMacroRecents() {
  const [recent, setRecent] = useState<string[]>(() => load());

  useEffect(() => {
    save(recent);
  }, [recent]);

  const markRecent = useCallback((id: string) => {
    setRecent((r) => pushRecent(r, id, MAX));
  }, []);

  return { recent, markRecent };
}
