/**
 * copilotLearning.ts — opt-in personal-style learning helpers (PR #80 Part 11).
 *
 * The Copilot can remember which suggestions a radiologist keeps ignoring, so it
 * stops surfacing them — but ONLY when the radiologist has explicitly enabled
 * learning (Part 11). Rather than add a table, this reuses the EXISTING
 * radiology_user_copilot_profiles.ignoredWarnings list (via the existing
 * GET/PATCH /api/radiology-copilot/profile endpoint). Copilot entries are
 * namespaced with a "copilot:" prefix so they never collide with any other
 * consumer of that list.
 *
 * These functions are pure (no I/O) so they're unit-testable; the React hook
 * layers persistence on top.
 */

const PREFIX = "copilot:";

/** The set of Copilot suggestion ids the radiologist has learned-ignored. */
export function extractLearnedIgnored(ignoredWarnings: readonly string[]): Set<string> {
  return new Set(
    ignoredWarnings.filter((w) => w.startsWith(PREFIX)).map((w) => w.slice(PREFIX.length)),
  );
}

/** Return a new ignoredWarnings list with `id` recorded as ignored (or cleared
 *  when the radiologist later accepts it), leaving every non-Copilot entry and
 *  every other Copilot entry untouched. */
export function withLearnedIgnored(ignoredWarnings: readonly string[], id: string, ignored: boolean): string[] {
  const key = PREFIX + id;
  const without = ignoredWarnings.filter((w) => w !== key);
  return ignored ? [...without, key] : without;
}

/** Remove ONLY the Copilot-namespaced entries — "Reset learning" (Part 11),
 *  preserving any other consumer's warnings. */
export function clearLearned(ignoredWarnings: readonly string[]): string[] {
  return ignoredWarnings.filter((w) => !w.startsWith(PREFIX));
}

/** The Copilot-namespaced ids only, for export (Part 11). */
export function learnedIgnoredList(ignoredWarnings: readonly string[]): string[] {
  return [...extractLearnedIgnored(ignoredWarnings)];
}
