import { useCallback, useEffect, useState } from "react";

/**
 * useCopilotPrefs — CARE Copilot per-radiologist preferences (PR #80 Parts 11/21).
 *
 * Client-side (localStorage) so toggling is instant and needs no backend round-
 * trip — mirrors useRadiologyPalettePrefs. Governs whether the Copilot panel is
 * shown, whether live analysis + auto-completion run, and whether opt-in
 * learning is enabled. The AI *provider* itself is configured centrally in AI
 * Reporting Settings (the existing provider abstraction) — not duplicated here.
 */

export interface CopilotPrefs {
  enabled: boolean; // show the Copilot tab + run analysis
  autoAnalyze: boolean; // live suggestions/issues as you type
  autoComplete: boolean; // GitHub-Copilot-style sentence completion (Part 12)
  learning: boolean; // opt-in personal-style learning (Part 11) — off by default
}

const KEY = "radiology.copilot.prefs.v1";
const DEFAULTS: CopilotPrefs = { enabled: true, autoAnalyze: true, autoComplete: true, learning: false };

function load(): CopilotPrefs {
  try {
    if (typeof localStorage === "undefined") return DEFAULTS;
    const v = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    return { ...DEFAULTS, ...(v && typeof v === "object" ? v : {}) };
  } catch {
    return DEFAULTS;
  }
}

export function useCopilotPrefs() {
  const [prefs, setPrefs] = useState<CopilotPrefs>(() => load());
  useEffect(() => {
    try {
      if (typeof localStorage !== "undefined") localStorage.setItem(KEY, JSON.stringify(prefs));
    } catch {
      /* private mode / quota — preferences are best-effort */
    }
  }, [prefs]);
  const set = useCallback((patch: Partial<CopilotPrefs>) => setPrefs((p) => ({ ...p, ...patch })), []);
  const reset = useCallback(() => setPrefs(DEFAULTS), []);
  return { prefs, set, reset };
}
