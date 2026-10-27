#!/usr/bin/env node
/**
 * Post-deployment build-identity verification.
 *
 * A Container Manager rebuild can silently ship the code that happens to be in
 * the checkout, and before build-info.json resolved the commit from Git metadata
 * there was no way to ask the running application what it was. This closes the
 * loop: ask the deployed API, compare against the commit the deploy intended, and
 * fail loudly when they differ — including when the answer cannot be trusted.
 *
 * Verdicts are deliberately three-valued. "Cannot reach it" and "it cannot say"
 * are UNKNOWN, not PASS: an unverifiable deploy is not a verified one.
 */
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

import { parseArgs, sameCommit } from "./build-identity.mjs";

export const PASS = "PASS";
export const FAIL = "FAIL";
export const UNKNOWN = "UNKNOWN";

const RESOLVED_SOURCES = new Set(["build-context-git"]);
const PLACEHOLDERS = new Set(["", "unknown", "null", "undefined", "none"]);
const COMMIT_SHAPED = /^[0-9a-f]{7,40}$/i;

const norm = (value) => String(value ?? "").trim().toLowerCase().replace(/^["']|["']$/g, "");

// One prefix rule for the whole repository, owned by build-identity.mjs: a stamp
// and a resolved SHA are the same commit only when the shorter is a real prefix.
export { sameCommit };

/**
 * The whole decision, with no I/O, so the rules are testable without a server.
 * `running` is what the deployed API said about itself; `expected` is the commit
 * the deploy was supposed to apply.
 */
export function verdictFor({ expected, running }) {
  if (!running) {
    return { status: UNKNOWN, detail: "the deployed API answered nothing, so its build identity is unknown" };
  }
  const reported = norm(running.commit);
  if (!reported || PLACEHOLDERS.has(reported)) {
    return {
      status: UNKNOWN,
      detail: `the running API reports commit "${running.commit ?? "(absent)"}" — no identity to compare against`,
      remediation: "This image was built before build-info.json resolved the commit from Git metadata, or the refs never reached the build context. Rebuild from a checkout that carries .git/HEAD and .git/refs.",
    };
  }
  if (!COMMIT_SHAPED.test(reported)) {
    // "HEAD" or a branch name is not a commit. Saying FAIL here would assert a
    // mismatch that was never measured; the honest answer is that it cannot be known.
    return {
      status: UNKNOWN,
      detail: `the running API reports commit "${running.commit}", which is not a commit`,
      remediation: "node scripts/build-identity.mjs --git-dir .git --print — the identity in the image is malformed, not merely different.",
    };
  }
  const source = norm(running.identitySource);
  if (!RESOLVED_SOURCES.has(source)) {
    return {
      status: UNKNOWN,
      detail: `commit ${reported.slice(0, 12)} is declared, not resolved (identitySource=${running.identitySource ?? "absent"}), so it proves nothing about these bytes`,
      remediation: "Check that .dockerignore still lets .git/HEAD and .git/refs into the build context: node scripts/build-identity.mjs --git-dir .git --print proves the host, and node scripts/docker-build-identity.mjs --tier context proves the image by building one",
    };
  }
  if (!expected) {
    return {
      status: UNKNOWN,
      detail: `running commit ${reported.slice(0, 12)} (source=${source}) but no expected commit was supplied to compare against`,
      remediation: "Pass the commit you deployed: node scripts/verify-deployed-identity.mjs --expected $(git rev-parse origin/main)",
    };
  }
  if (sameCommit(expected, reported)) {
    return {
      status: PASS,
      detail: `running commit ${reported.slice(0, 12)} is the deployed commit${running.staleStampDetected ? " (the .env stamp disagreed and was correctly ignored)" : ""}`,
    };
  }
  return {
    status: FAIL,
    detail: `expected ${norm(expected).slice(0, 12)} but the running API is ${reported.slice(0, 12)} (built ${running.imageBuiltAt ?? "unknown"})`,
    remediation: "The container is not running the code the deploy intended. Do not treat this deployment as applied: rebuild the EXISTING care-erp-github project from the checkout at the expected commit, or roll back to the recorded image IDs.",
  };
}

/** Two surfaces, one answer: /health and /api/health must not disagree. */
export function crossCheck(health, apiHealth) {
  if (!apiHealth || !health) return null;
  const a = norm(health.commit);
  const b = norm(apiHealth?.build?.commit ?? apiHealth?.commit);
  if (!b || PLACEHOLDERS.has(b)) return null;
  return sameCommit(a, b) ? null : `/health says ${a.slice(0, 12)} while /api/health says ${b.slice(0, 12)}`;
}

async function fetchJson(url, timeoutMs) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return { error: `HTTP ${res.status}` };
    return { json: await res.json() };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

const USAGE = `verify-deployed-identity — prove the running CARE API is the commit you deployed

  node scripts/verify-deployed-identity.mjs --expected $(git rev-parse origin/main)
  node scripts/verify-deployed-identity.mjs --expected <sha> --base-url http://127.0.0.1:8888 --json

Exit 0 PASS, 1 FAIL, 2 UNKNOWN (unreachable, silent, or unverifiable).
UNKNOWN never means deployed-correctly.`;

export async function main(argv = process.argv.slice(2), { fetchImpl = fetchJson } = {}) {
  const args = parseArgs(argv);
  if (args.help || args.h) {
    process.stdout.write(USAGE + "\n");
    return 0;
  }
  if (args.url && !args["base-url"]) args["base-url"] = args.url;
  const base = String(args["base-url"] || process.env.CARE_HEALTH_BASE_URL || "http://127.0.0.1:8888").replace(/\/+$/, "");
  const timeoutMs = Number(args.timeout || 12_000);
  const expected = typeof args.expected === "string" ? args.expected : null;

  const health = await fetchImpl(`${base}/health`, timeoutMs);
  const apiHealth = await fetchImpl(`${base}/api/health`, timeoutMs);

  if (health.error) {
    const result = {
      status: UNKNOWN,
      detail: `could not read ${base}/health (${health.error})`,
      remediation: "Is care-web/care-api up, and is this the port they publish? docker ps --format '{{.Names}} {{.Status}}'",
    };
    return report(args, result, 2);
  }

  const running = {
    commit: health.json?.commit,
    identitySource: health.json?.identitySource,
    staleStampDetected: health.json?.staleStampDetected === true,
    imageBuiltAt: health.json?.imageBuiltAt,
  };
  const result = verdictFor({ expected, running });
  const conflict = result.status === PASS ? crossCheck(health.json, apiHealth.json) : null;
  if (conflict) {
    return report(
      args,
      { status: UNKNOWN, detail: `${result.detail}; but the two health surfaces disagree: ${conflict}`, remediation: "One of the two surfaces is reading a different build identity — check buildIdentityPayload usage in app.ts and routes/health.ts." },
      2,
    );
  }
  if (!apiHealth.error && result.status !== UNKNOWN) {
    result.declaredCommit = health.json?.declaredCommit ?? null;
    result.artifact = health.json?.artifact ?? null;
    result.version = health.json?.version ?? null;
    result.build = health.json?.build ?? null;
  }
  return report(args, result, result.status === PASS ? 0 : result.status === FAIL ? 1 : 2);
}

function report(args, result, code) {
  const payload = { ...result, checked_at: new Date().toISOString() };
  if (args.json) {
    process.stdout.write(JSON.stringify(payload, null, 2) + "\n");
  } else {
    process.stdout.write(`${result.status}: ${result.detail}\n`);
    if (result.remediation) process.stdout.write(`   do this: ${result.remediation}\n`);
  }
  return code;
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (invokedDirectly) main().then((code) => { process.exitCode = code; });
