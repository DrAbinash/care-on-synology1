/**
 * Deployment build identity — commit SHA stamped at image/build time.
 *
 * Canonical env: GIT_COMMIT (existing Synology/compose convention).
 * Optional aliases: CARE_GIT_SHA, VITE_GIT_COMMIT (same value, never invent).
 * Never reads secrets or dumps process.env.
 */

import { readFileSync } from "node:fs";

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
  image: ImageBuildInfo = loadImageBuildInfo(),
): { commit: string; imageBuiltAt: string | null; artifactSha256: string | null } {
  return {
    commit: resolveBuildCommit(env),
    imageBuiltAt: image.imageBuiltAt,
    artifactSha256: image.artifactSha256,
  };
}

/**
 * Identity the image derives about ITSELF, written by the Dockerfile from the
 * build clock and a hash of the bytes actually shipped.
 *
 * This exists because the stamped commit cannot be trusted. `GIT_COMMIT` arrives
 * as a build ARG from `.env`, and only `deploy-synology.sh` refreshes `.env` — so
 * a rebuild started from Docker CLI or Synology Container Manager re-bakes the
 * PREVIOUS deploy's SHA into newer code. It did: `/health` reported `2d51e8d7`
 * (2026-09-16) while `dist/` contained `sync_divergence`, merged 2026-10-12, and
 * the served SPA chunks contained October-only features. `.git` is excluded from
 * the build context (`.dockerignore`), so an image cannot resolve a SHA — but it
 * can always say when it was built and what it holds, and those two facts are
 * enough to catch a stale stamp instead of believing it.
 */
export type ImageBuildInfo = {
  imageBuiltAt: string | null;
  artifactSha256: string | null;
  declaredGitCommit: string | null;
};

const EMPTY_IMAGE_INFO: ImageBuildInfo = {
  imageBuiltAt: null,
  artifactSha256: null,
  declaredGitCommit: null,
};

/** Parse the build-info.json body. Pure; absent or malformed input yields nulls. */
export function parseImageBuildInfo(raw: string | null | undefined): ImageBuildInfo {
  if (!raw) return EMPTY_IMAGE_INFO;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return EMPTY_IMAGE_INFO;
  }
  if (typeof data !== "object" || data === null) return EMPTY_IMAGE_INFO;
  const text = (key: string): string | null => {
    const value = (data as Record<string, unknown>)[key];
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    // "unknown" is the Dockerfile ARG default, not evidence of anything.
    if (!trimmed || PLACEHOLDERS.has(trimmed.toLowerCase())) return null;
    return trimmed;
  };
  return {
    imageBuiltAt: text("imageBuiltAt"),
    artifactSha256: text("artifactSha256"),
    declaredGitCommit: text("declaredGitCommit"),
  };
}

let cachedImageBuildInfo: ImageBuildInfo | null = null;

/** Read `/app/build-info.json` once per process. Never throws. */
export function loadImageBuildInfo(
  paths: string[] = ["/app/build-info.json", "build-info.json"],
): ImageBuildInfo {
  if (cachedImageBuildInfo) return cachedImageBuildInfo;
  for (const path of paths) {
    try {
      cachedImageBuildInfo = parseImageBuildInfo(readFileSync(path, "utf8"));
      return cachedImageBuildInfo;
    } catch {
      /* next candidate */
    }
  }
  cachedImageBuildInfo = EMPTY_IMAGE_INFO;
  return cachedImageBuildInfo;
}

/** True when both sides are known and disagree (diagnostics only). */
export function buildsMismatch(frontend: string, api: string): boolean {
  const a = normalizeBuildCommit(frontend);
  const b = normalizeBuildCommit(api);
  if (a === "unknown" || b === "unknown") return false;
  return a !== b;
}
