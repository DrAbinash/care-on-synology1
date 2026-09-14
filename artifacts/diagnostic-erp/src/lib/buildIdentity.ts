/**
 * Frontend release identity — commit SHA baked at Vite build time.
 * Source: import.meta.env.VITE_GIT_COMMIT (from GIT_COMMIT / CARE_GIT_SHA / git).
 * Fallback: "unknown" — never throws.
 */

const PLACEHOLDERS = new Set(["", "unknown", "null", "undefined"]);

export function normalizeBuildCommit(
  raw: string | undefined | null,
  maxLen = 12,
): string {
  const t = String(raw ?? "")
    .trim()
    .replace(/^["']|["']$/g, "");
  if (!t || PLACEHOLDERS.has(t.toLowerCase())) return "unknown";
  const token = t.split(/\s+/)[0] ?? t;
  if (!token || PLACEHOLDERS.has(token.toLowerCase())) return "unknown";
  return token.slice(0, Math.max(1, maxLen));
}

/** Baked SPA commit (short). Safe when Vite define/env is missing. */
export function getFrontendBuildCommit(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const env = (import.meta as any)?.env as Record<string, string | undefined> | undefined;
    return normalizeBuildCommit(env?.VITE_GIT_COMMIT);
  } catch {
    return "unknown";
  }
}

/** Diagnostics-only: known SHAs that disagree. Unknown never blocks. */
export function buildsMismatch(frontend: string, api: string): boolean {
  const a = normalizeBuildCommit(frontend);
  const b = normalizeBuildCommit(api);
  if (a === "unknown" || b === "unknown") return false;
  return a !== b;
}
