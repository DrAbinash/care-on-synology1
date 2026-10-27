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
): {
  commit: string;
  identitySource: string;
  imageBuiltAt: string | null;
  artifactSha256: string | null;
  gitBranch: string | null;
  declaredGitCommit: string | null;
  staleStampDetected: boolean;
  version: string | null;
  buildNumber: string | null;
} {
  // The image's own resolved commit outranks the env stamp, because the env stamp
  // is whatever .env said at build time and .env is refreshed by only one of the
  // two ways this image gets built. When the context could not resolve a commit,
  // the declared value is still reported — labelled, so nobody mistakes it for proof.
  const fromImage = image.commit ? normalizeBuildCommit(image.commit) : null;
  const fromEnv = resolveBuildCommit(env);
  const commit = fromImage || fromEnv;
  const identitySource = fromImage
    ? image.identitySource || "build-info-without-source"
    : image.declaredGitCommit || fromEnv !== "unknown"
      ? "build-arg-declared"
      : "unknown";
  return {
    commit,
    identitySource,
    imageBuiltAt: image.imageBuiltAt,
    artifactSha256: image.artifactSha256,
    gitBranch: image.gitBranch,
    declaredGitCommit: image.declaredGitCommit,
    version: image.version,
    buildNumber: image.buildNumber,
    staleStampDetected:
      image.staleStampDetected ||
      (!!fromImage && !!image.declaredGitCommit && !sameCommit(image.declaredGitCommit, image.commit)),
  };
}

/** `2d51e8d7` and `2d51e8d7ab…` are the same commit; a 6-char prefix is not. */
function sameCommit(a: string | null, b: string | null): boolean {
  const x = String(a ?? "").trim().toLowerCase();
  const y = String(b ?? "").trim().toLowerCase();
  if (!x || !y) return false;
  const len = Math.min(x.length, y.length);
  return len >= 7 && x.slice(0, len) === y.slice(0, len);
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
 * the served SPA chunks contained October-only features. The image now resolves
 * the commit itself: `.dockerignore` lets `.git/HEAD` and the refs into the build
 * context, `scripts/build-identity.mjs` turns them into `commit`, and whatever
 * `.env` claimed is kept beside it as `declaredGitCommit` so a disagreement is
 * visible (`staleStampDetected`) instead of believed.
 */
export type ImageBuildInfo = {
  imageBuiltAt: string | null;
  artifactSha256: string | null;
  declaredGitCommit: string | null;
  /** The commit the build context's own Git refs name. Null when unresolvable. */
  commit: string | null;
  identitySource: string | null;
  gitBranch: string | null;
  staleStampDetected: boolean;
  version: string | null;
  buildNumber: string | null;
};

const EMPTY_IMAGE_INFO: ImageBuildInfo = {
  imageBuiltAt: null,
  artifactSha256: null,
  declaredGitCommit: null,
  commit: null,
  identitySource: null,
  gitBranch: null,
  staleStampDetected: false,
  version: null,
  buildNumber: null,
};

const COMMIT_SHAPED = /^[0-9a-f]{7,40}$/i;

/**
 * Parse the build-info.json body. Pure; absent or malformed input yields nulls.
 *
 * `commit` is validated rather than trusted: a build-info written by an older
 * Dockerfile, or hand-edited on a box, must not become an authoritative identity
 * just because a key with that name exists.
 */
export function parseImageBuildInfo(raw: string | null | undefined): ImageBuildInfo {
  if (!raw) return EMPTY_IMAGE_INFO;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return EMPTY_IMAGE_INFO;
  }
  if (typeof data !== "object" || data === null) return EMPTY_IMAGE_INFO;
  const fields = data as Record<string, unknown>;
  const text = (key: string): string | null => {
    const value = fields[key];
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    // "unknown" is the Dockerfile ARG default, not evidence of anything.
    if (!trimmed || PLACEHOLDERS.has(trimmed.toLowerCase())) return null;
    return trimmed;
  };
  const resolved = text("commit");
  return {
    imageBuiltAt: text("imageBuiltAt"),
    artifactSha256: text("artifactSha256"),
    declaredGitCommit: text("declaredGitCommit"),
    commit: resolved && COMMIT_SHAPED.test(resolved) ? resolved : null,
    identitySource: text("identitySource"),
    gitBranch: text("gitBranch"),
    staleStampDetected: fields.staleStampDetected === true,
    version: text("version"),
    buildNumber: text("buildNumber"),
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
