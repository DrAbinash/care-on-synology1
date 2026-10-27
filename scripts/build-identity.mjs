#!/usr/bin/env node
/**
 * Build identity — derived from the build context, not from `.env`.
 *
 * `GIT_COMMIT` reaches an image as a compose build arg whose value comes from
 * `.env`, and only `deploy-synology.sh` Step 2 rewrites `.env`. A rebuild started
 * from Docker CLI or Synology Container Manager therefore re-bakes the PREVIOUS
 * deploy's SHA into NEWER code: measured on 2026-10-15, `/health` reported
 * `2d51e8d7` (2026-09-16) for an image built from `3f044107`. This module reads
 * the commit out of the Git metadata that was actually copied into the build
 * context, so the identity cannot outlive the code it describes.
 *
 * Degradation is deliberate and never silent: when the context carries no Git
 * metadata, the resolver says so in `identitySource` and keeps the declared stamp
 * as a *declared* value. Callers must treat `build-arg-declared` as unverified.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const PLACEHOLDERS = new Set(["", "unknown", "null", "undefined", "none", "dev"]);
const FULL_SHA = /^[0-9a-f]{40}$/i;
const SHORT_SHA = /^[0-9a-f]{7,40}$/i;

export const SOURCE_GIT = "build-context-git";
export const SOURCE_DECLARED = "build-arg-declared";
export const SOURCE_UNKNOWN = "unknown";

const clean = (value) => {
  const text = String(value ?? "").trim().replace(/^["']|["']$/g, "");
  return !text || PLACEHOLDERS.has(text.toLowerCase()) ? null : text;
};

/** True only for a plausible commit string. */
export function isCommit(value) {
  const text = clean(value);
  return !!text && SHORT_SHA.test(text);
}

/**
 * Compare two commit strings that may be different lengths, as a stamp and a
 * resolved SHA always are: `2d51e8d7` is the same commit as
 * `2d51e8d7abcd…`, and nothing is inferred beyond the shared prefix.
 */
export function sameCommit(a, b) {
  const x = clean(a);
  const y = clean(b);
  if (!x || !y) return false;
  const len = Math.min(x.length, y.length);
  if (len < 7) return false;
  return x.slice(0, len).toLowerCase() === y.slice(0, len).toLowerCase();
}

/** HEAD is either `ref: refs/heads/<branch>` or, detached, a bare SHA. */
export function readGitHead(gitDir) {
  const file = path.join(gitDir, "HEAD");
  if (!existsSync(file)) return { ref: null, commit: null, reason: "no HEAD file" };
  const line = (readFileSync(file, "utf8").split(/\r?\n/)[0] || "").trim();
  if (!line) return { ref: null, commit: null, reason: "HEAD is empty" };
  const ref = line.match(/^ref:\s+(\S+)$/i);
  if (ref) return { ref: ref[1], commit: null, reason: null };
  if (FULL_SHA.test(line)) return { ref: null, commit: line, reason: "detached HEAD" };
  return { ref: null, commit: null, reason: "HEAD is neither a ref nor a SHA" };
}

/** Resolve a ref name to a SHA: loose ref file first, then packed-refs. */
export function refCommit(gitDir, refName) {
  if (!refName) return null;
  const loose = path.join(gitDir, ...refName.split("/"));
  if (existsSync(loose) && statSync(loose).isFile()) {
    const sha = (readFileSync(loose, "utf8").split(/\r?\n/)[0] || "").trim();
    if (FULL_SHA.test(sha)) return sha;
  }
  const packed = path.join(gitDir, "packed-refs");
  if (existsSync(packed)) {
    for (const line of readFileSync(packed, "utf8").split(/\r?\n/)) {
      if (line.startsWith("#") || line.startsWith("^")) continue;
      const m = line.match(/^([0-9a-f]{40})\s+(\S+)$/i);
      if (m && m[2] === refName) return m[1];
    }
  }
  return null;
}

/**
 * The commit this checkout was built from, as the context can prove it.
 * `branch` is the ref that was built, which is not necessarily the branch name —
 * a detached checkout says so rather than inventing one.
 */
export function resolveGitIdentity(gitDir) {
  const head = readGitHead(gitDir);
  if (head.commit) {
    return { commit: head.commit, branch: null, ref: "HEAD", detached: true, reason: head.reason };
  }
  if (head.ref) {
    const commit = refCommit(gitDir, head.ref);
    return {
      commit,
      branch: head.ref.startsWith("refs/heads/") ? head.ref.slice("refs/heads/".length) : null,
      ref: head.ref,
      detached: false,
      reason: commit ? null : `ref ${head.ref} resolves in neither a loose file nor packed-refs`,
    };
  }
  return { commit: null, branch: null, ref: null, detached: false, reason: head.reason || "no git metadata" };
}

/** Hash the bytes that will actually ship — never reuse a recorded hash. */
export function artifactSha(artifactPath, length = 16) {
  if (!artifactPath || !existsSync(artifactPath)) return null;
  const hash = createHash("sha256").update(readFileSync(artifactPath)).digest("hex");
  return hash.slice(0, length);
}

export function readVersionInfo(versionFile) {
  if (!versionFile || !existsSync(versionFile)) return {};
  try {
    const data = JSON.parse(readFileSync(versionFile, "utf8"));
    return {
      version: clean(data.version) ?? null,
      buildNumber: data.buildNumber === undefined || data.buildNumber === null ? null : String(data.buildNumber),
      releaseName: clean(data.releaseName) ?? null,
    };
  } catch {
    return {};
  }
}

/**
 * Everything the image can honestly say about itself. `commit` is the answer to
 * "what code is running"; `declaredGitCommit` is kept beside it so a disagreement
 * is visible instead of silently preferred by whichever side was read first.
 */
export function composeIdentity(options = {}) {
  const {
    gitDir = ".git",
    declaredCommit = null,
    declaredBranch = null,
    declaredTag = null,
    versionFile = "version.json",
    artifactPath = null,
    builtAt = null,
  } = options;

  const git = resolveGitIdentity(gitDir);
  const declared = clean(declaredCommit);
  const fromGit = isCommit(git.commit) ? git.commit : null;

  const identitySource = fromGit ? SOURCE_GIT : declared ? SOURCE_DECLARED : SOURCE_UNKNOWN;
  const commit = fromGit || declared || null;
  const staleStampDetected = !!(fromGit && declared && !sameCommit(declared, fromGit));

  return {
    imageBuiltAt: builtAt || new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    artifactSha256: artifactSha(artifactPath),
    commit,
    identitySource,
    gitCommitResolved: fromGit,
    gitBranch: git.branch || clean(declaredBranch) || null,
    gitRef: git.ref,
    gitDetached: !!git.detached,
    gitResolveReason: fromGit ? null : git.reason || null,
    declaredGitCommit: declared,
    declaredGitBranch: clean(declaredBranch),
    declaredGitTag: clean(declaredTag),
    staleStampDetected,
    ...readVersionInfo(versionFile),
  };
}

/** `--flag value` and `--flag=value`, quietly ignoring anything unknown. */
export function parseArgs(argv = []) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = String(argv[i] ?? "");
    if (!token.startsWith("--")) continue;
    const eq = token.indexOf("=");
    if (eq > -1) {
      out[token.slice(2, eq)] = token.slice(eq + 1);
      continue;
    }
    const next = String(argv[i + 1] ?? "");
    if (next.startsWith("--") || next === "") {
      out[token.slice(2)] = true;
    } else {
      out[token.slice(2)] = next;
      i += 1;
    }
  }
  return out;
}

const USAGE = `build-identity — resolve the commit an image was really built from

  node scripts/build-identity.mjs \\
      --git-dir .git \\
      --artifact ./artifacts/api-server/dist/index.mjs \\
      --version-file version.json \\
      --declared-commit "$GIT_COMMIT" --declared-branch "$GIT_BRANCH" \\
      --out ./build-info.json

  --print            also write the identity JSON to stdout
  --require-git      exit 2 when the identity did not come from git metadata

The Dockerfile runs this inside the build stage, where the checkout's .git
metadata is present in the context. Never trust "identitySource":
"${SOURCE_DECLARED}" as proof of what is deployed.`;

export function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help || args.h) {
    process.stdout.write(USAGE + "\n");
    return 0;
  }
  const cwd = process.cwd();
  const abs = (p) => (p && path.isAbsolute(p) ? p : path.join(cwd, p || ""));
  const identity = composeIdentity({
    gitDir: abs(args["git-dir"] || ".git"),
    declaredCommit: typeof args["declared-commit"] === "string" ? args["declared-commit"] : null,
    declaredBranch: typeof args["declared-branch"] === "string" ? args["declared-branch"] : null,
    declaredTag: typeof args["declared-tag"] === "string" ? args["declared-tag"] : null,
    versionFile: abs(args["version-file"] || "version.json"),
    artifactPath: args.artifact ? abs(String(args.artifact)) : null,
    builtAt: typeof args["built-at"] === "string" ? args["built-at"] : null,
  });

  const outPath = args.out ? abs(String(args.out)) : null;
  if (outPath) writeFileSync(outPath, JSON.stringify(identity) + "\n");
  if (args.print || !outPath) process.stdout.write(JSON.stringify(identity, null, 2) + "\n");

  if (args["require-git"] && identity.identitySource !== SOURCE_GIT) {
    process.stderr.write(
      `build identity did not come from git metadata (source=${identity.identitySource}, reason=${identity.gitResolveReason || "none"}). Nothing was proven about the deployed commit.\n`,
    );
    return 2;
  }
  return 0;
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (invokedDirectly) process.exitCode = main();
