/**
 * Deployment build identity — commit SHA stamped at image/build time.
 *
 * Canonical env: GIT_COMMIT (existing Synology/compose convention).
 * Optional aliases: CARE_GIT_SHA, VITE_GIT_COMMIT (same value, never invent).
 * Never reads secrets or dumps process.env.
 */

const PLACEHOLDERS = new Set(["", "unknown", "null", "undefined"]);

/** Normalize a raw SHA/tag to a short display commit (default 12 hex chars). */
export function normalizeBuildCommit(
  raw: string | undefined | null,
  maxLen = 12,
): string {
  const t = String(raw ?? "")
    .trim()
    .replace(/^["']|["']$/g, "");
  if (!t || PLACEHOLDERS.has(t.toLowerCase())) return "unknown";
  // Prefer the first whitespace-separated token (avoid accidental multi-value env).
  const token = t.split(/\s+/)[0] ?? t;
  if (!token || PLACEHOLDERS.has(token.toLowerCase())) return "unknown";
  return token.slice(0, Math.max(1, maxLen));
}

/**
 * Resolve the process build commit from env / optional version.json-style fields.
 * Prefer build-time GIT_COMMIT; never shell out to git at request time.
 */
export function resolveBuildCommit(
  env: NodeJS.ProcessEnv = process.env,
  extras?: { gitCommit?: string | null },
): string {
  return normalizeBuildCommit(
    env.GIT_COMMIT ||
      env.CARE_GIT_SHA ||
      env.VITE_GIT_COMMIT ||
      extras?.gitCommit ||
      undefined,
  );
}

/** Payload fragment for health / diagnostics — no secrets. */
export function buildIdentityPayload(
  env: NodeJS.ProcessEnv = process.env,
): { commit: string } {
  return { commit: resolveBuildCommit(env) };
}

/** True when both sides are known and disagree (diagnostics only). */
export function buildsMismatch(frontend: string, api: string): boolean {
  const a = normalizeBuildCommit(frontend);
  const b = normalizeBuildCommit(api);
  if (a === "unknown" || b === "unknown") return false;
  return a !== b;
}
