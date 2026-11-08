/**
 * U1 — validation for the snippet-macro prompt popover
 * (zai-workspace/macro-prompt-popover.tsx).
 *
 * The popover's keyboard handler used to apply on Enter (and Tab — see the
 * already-filed B11) from ANY input, with no per-variable validation, and
 * `expandMacro` substitutes an unfilled, default-less variable with a literal
 * `___`. Pressing Enter after the first of several variables therefore wrote
 * `Mild ___ disc protrusion…` into clinical text — and if unnoticed, that
 * printed. This module is the pure readiness computation the popover now
 * gates Apply on; `___` can no longer reach the report through the popover.
 */
import type { SnippetMacro } from "./types";

export interface MacroPromptReadiness {
  /** Apply is safe: every variable resolves to real text, never `___`. */
  canApply: boolean;
  /** How many variables currently have a concrete value. */
  filled: number;
  total: number;
  /** Index of the first variable still needing input (focus target), or null. */
  firstUnfilledIndex: number | null;
}

/**
 * A variable is filled when its value is non-empty, OR it has a default, OR
 * it declares options (a <select> — the popover initializes those to
 * `default ?? options[0]`, so an options variable always resolves).
 */
export function macroPromptReadiness(
  variables: Pick<SnippetMacro, "variables">["variables"],
  values: Record<string, string>,
): MacroPromptReadiness {
  let filled = 0;
  let firstUnfilledIndex: number | null = null;
  variables.forEach((v, i) => {
    const value = (values[v.name] ?? "").trim();
    const hasDefault = !!(v.default ?? "").trim();
    const hasOptions = (v.options ?? []).filter((o) => !!(o ?? "").trim()).length > 0;
    const isFilled = value.length > 0 || hasDefault || hasOptions;
    if (isFilled) filled += 1;
    else if (firstUnfilledIndex === null) firstUnfilledIndex = i;
  });
  return {
    canApply: filled === variables.length,
    filled,
    total: variables.length,
    firstUnfilledIndex,
  };
}

/** Initial values for the popover: defaults first, then the first option. */
export function initialMacroValues(
  variables: Pick<SnippetMacro, "variables">["variables"],
): Record<string, string> {
  const init: Record<string, string> = {};
  for (const v of variables) {
    init[v.name] = v.default ?? (v.options ?? [])[0] ?? "";
  }
  return init;
}
