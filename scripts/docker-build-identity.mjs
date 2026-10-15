#!/usr/bin/env node
/**
 * Disposable Docker build proof for the build-identity claim.
 *
 * PR #1015's assertion is that an image can name the commit it was really built
 * from, and that a stamp handed in by `.env` cannot overrule that. Until this
 * file, the claim was pinned by reading `.dockerignore` and the Dockerfile as
 * text (`scripts/buildIdentity.test.mjs`), because the development box has no
 * Docker. A text grep cannot catch the failure it is guarding: BuildKit and the
 * legacy builder disagree on whether `!.git/refs` re-includes a directory's
 * children, so a context can end up with no refs while every grep still matches.
 *
 * This runs the real thing: `docker build` with this repository as the context,
 * then `docker cp` the identity files the resolver wrote inside the image and
 * grade them here. Two tiers:
 *
 *   --tier context  (default) the probe Dockerfile — `COPY . .` plus the real
 *                   resolver under four conditions. Seconds, and it is the
 *                   `.dockerignore` claim proved rather than described.
 *   --tier real     `docker build --target api-build` of the PRODUCTION
 *                   Dockerfile with a deliberately stale GIT_COMMIT, then the
 *                   same grading plus a hash of the artifact the image shipped.
 *                   Costs a full in-image `pnpm install` + build.
 *
 * Verdicts are four-valued and the exit code only reaches 0 for PASS. No Docker
 * is UNAVAILABLE (3), an arm the environment could not exercise is UNVERIFIED (2)
 * — never quietly credited as a pass, because "the test ran" is not "the test
 * proved anything".
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { parseArgs, sameCommit, SOURCE_DECLARED, SOURCE_GIT } from "./build-identity.mjs";

export const PASS = "PASS";
export const FAIL = "FAIL";
export const UNVERIFIED = "UNVERIFIED";
export const UNAVAILABLE = "UNAVAILABLE";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.join(HERE, "..");
export const PROBE_DOCKERFILE = path.join("scripts", "docker", "build-identity-probe.Dockerfile");

/**
 * The stamp this proof feeds in as the lie. `2d51e8d7` is used deliberately: it
 * is the commit `/health` reported on 2026-10-15 for an image built from
 * `3f044107`, so the harness hands the build the exact value that shipped code
 * under a false name. It is 40 hex characters because that is what compose
 * bakes, and a resolver that matched on string length rather than prefix would
 * never notice a shorter lie.
 */
export const STALE_STAMP = "2d51e8d72d51e8d72d51e8d72d51e8d72d51e8d7";

/** A stamp that cannot collide with the checkout being built. */
export function staleStampFor(headSha) {
  return sameCommit(STALE_STAMP, headSha) ? "0123456789012345678901234567890123456789" : STALE_STAMP;
}

/**
 * The contract the runbook documents and the CI step depends on. Exported so
 * `docs/CARE_ERP_DEPLOYMENT_RUNBOOK.md` can be checked against it rather than
 * against someone's memory of it: only 0 may be read as proof.
 */
export const EXIT_CODES = { [PASS]: 0, [FAIL]: 1, [UNVERIFIED]: 2, [UNAVAILABLE]: 3 };

const exitCode = EXIT_CODES;

/** The one comparison rule: the image must name the checkout, not the argument. */
const pass = (name, expected, actual, note) => ({ name, expected, actual, status: "pass", note });
const fail = (name, expected, actual, note) => ({ name, expected, actual, status: "fail", note });
const unverified = (name, expected, actual, note) => ({ name, expected, actual, status: "unverified", note });

function grade(verdicts) {
  const failed = verdicts.filter((v) => v.status === "fail");
  const open = verdicts.filter((v) => v.status === "unverified");
  if (failed.length) return FAIL;
  if (open.length) return UNVERIFIED;
  return PASS;
}

/**
 * `context.tsv` — what the build context actually received. `head-first-line`
 * decides whether the refs arm can mean anything: a detached HEAD resolves from
 * HEAD alone, so hiding the refs would change nothing and a green "pass" there
 * would be a lie about coverage.
 */
export function parseContextManifest(text) {
  const fields = {};
  for (const line of String(text ?? "").split(/\r?\n/)) {
    const m = /^([a-z0-9-]+)\t(.*)$/i.exec(line.trim());
    if (m) fields[m[1]] = m[2];
  }
  const headFirstLine = fields["head-first-line"] ?? "";
  return {
    raw: fields,
    headFirstLine,
    symbolicHead: /^ref:\s*\S+/i.test(headFirstLine),
    detachedHead: /^[0-9a-f]{40}$/i.test(headFirstLine),
    refsLooseCount: Number(fields["refs-loose-count"] ?? 0),
    packedRefsPresent: fields["packed-refs-present"] === "yes",
    objectsPresent: fields["objects-present"] === "YES",
    contextFiles: (fields["context-files"] || "").trim(),
  };
}

const readArm = (dir, name) => {
  try {
    return JSON.parse(readFileSync(path.join(dir, `${name}.json`), "utf8"));
  } catch {
    return null;
  }
};

/**
 * The four arms, graded. `headSha` is the commit the host checkout is on — the
 * answer the image must independently arrive at.
 */
export function evaluateProbe({ manifest, arms, headSha, staleStamp }) {
  const v = [];
  const [a, b, c, d] = ["a", "b", "c", "d"].map((k) => arms[k]);

  for (const [name, arm] of [["A stale stamp", a], ["B agreeing stamp", b], ["C refs removed", c], ["D HEAD removed", d]]) {
    if (!arm) {
      v.push(fail(`${name}: build-info.json`, "a file written by the resolver", "absent", `${name} never produced an identity — the RUN failed or /out was not copied`));
    }
  }
  if (v.some((x) => x.status === "fail")) return { verdicts: v, status: grade(v) };

  // A — the defect itself.
  v.push(
    a.commit === headSha
      ? pass("A commit is the checkout", headSha, a.commit, "the context's git metadata named the build")
      : fail("A commit is the checkout", headSha, a.commit, "the image reported a commit it was not built from — this is the stale-stamp defect"),
  );
  v.push(
    a.identitySource === SOURCE_GIT
      ? pass("A identitySource", SOURCE_GIT, a.identitySource)
      : fail("A identitySource", SOURCE_GIT, a.identitySource, `refs never reached the context, so the identity is a claim, not a measurement (reason=${a.gitResolveReason ?? "none"})`),
  );
  v.push(
    sameCommit(a.declaredGitCommit, staleStamp)
      ? pass("A the lie arrived intact", staleStamp, a.declaredGitCommit, "proves the build arg was supplied, so arm A is a real test of precedence")
      : fail("A the lie arrived intact", staleStamp, a.declaredGitCommit, "the stale stamp did not reach the resolver, so nothing was precedence-tested"),
  );
  v.push(
    a.staleStampDetected === true
      ? pass("A staleStampDetected", true, a.staleStampDetected)
      : fail("A staleStampDetected", true, a.staleStampDetected, "a build was handed an unrelated commit and called it a day"),
  );

  // B — the always-true control.
  v.push(
    b.staleStampDetected === false
      ? pass("B agreeing stamp is not flagged", false, b.staleStampDetected, "arm A is a measurement, not a constant")
      : fail("B agreeing stamp is not flagged", false, b.staleStampDetected, "a resolver that flags every build stale makes arm A meaningless"),
  );
  v.push(
    b.commit === headSha
      ? pass("B commit is the checkout", headSha, b.commit)
      : fail("B commit is the checkout", headSha, b.commit),
  );

  // C — the refs are load-bearing.
  const refsWereThere = manifest.refsLooseCount > 0 || manifest.packedRefsPresent;
  if (!refsWereThere) {
    v.push(unverified("C refs removed degrade the identity", SOURCE_DECLARED, "nothing to remove", "the context carried no refs at all, so arm C could not have changed the answer"));
  } else if (manifest.detachedHead) {
    v.push(unverified("C refs removed degrade the identity", SOURCE_DECLARED, "detached HEAD", "HEAD held a SHA, which resolves without refs — arm C only means something on a symbolic-HEAD checkout (the NAS deploy checkout)"));
  } else {
    v.push(
      c.identitySource === SOURCE_DECLARED
        ? pass("C refs removed degrade the identity", SOURCE_DECLARED, c.identitySource)
        : fail("C refs removed degrade the identity", SOURCE_DECLARED, c.identitySource, "the identity survived with the refs hidden, so it did not come from them"),
    );
    v.push(
      sameCommit(c.commit, staleStamp)
        ? pass("C falls back to the declared stamp", staleStamp, c.commit, "the degradation is honest: the stamp is kept, labelled unverified")
        : fail("C falls back to the declared stamp", staleStamp, c.commit, "with no refs and no HEAD ref, the resolver invented an answer"),
    );
  }

  // D — HEAD is load-bearing.
  if (!manifest.headFirstLine) {
    v.push(unverified("D HEAD removed degrades the identity", SOURCE_DECLARED, "no HEAD in context", ".git/HEAD did not arrive, which is itself the failure arm C exists to catch"));
  } else {
    v.push(
      d.identitySource === SOURCE_DECLARED
        ? pass("D HEAD removed degrades the identity", SOURCE_DECLARED, d.identitySource)
        : fail("D HEAD removed degrades the identity", SOURCE_DECLARED, d.identitySource, "the identity survived without .git/HEAD, so it is not derived from the checkout"),
    );
  }

  // The small-context half of the promise.
  v.push(
    manifest.objectsPresent
      ? fail("objects stay out of the context", "absent", "present", ".git/objects reached the build context — the negations re-included more than the refs")
      : pass("objects stay out of the context", "absent", "absent"),
  );

  return { verdicts: v, status: grade(v) };
}

/**
 * The production Dockerfile tier. The file the api-build stage wrote is graded
 * exactly like arm A, and the artifact hash is re-computed here from the bytes
 * copied OUT of the image — which is the only way to know the hash describes
 * what ships rather than what happened to be on the build machine.
 */
export function evaluateRealBuild({ buildInfo, headSha, staleStamp, artifactBytes }) {
  const v = [];
  if (!buildInfo) {
    return { verdicts: [fail("api-build build-info.json", "a file at /repo/build-info.json", "absent", "the production stage never wrote an identity")], status: FAIL };
  }
  v.push(
    buildInfo.commit === headSha
      ? pass("real commit is the checkout", headSha, buildInfo.commit)
      : fail("real commit is the checkout", headSha, buildInfo.commit, "the production image names a commit it was not built from"),
  );
  v.push(
    buildInfo.identitySource === SOURCE_GIT
      ? pass("real identitySource", SOURCE_GIT, buildInfo.identitySource)
      : fail("real identitySource", SOURCE_GIT, buildInfo.identitySource, `production build degraded (reason=${buildInfo.gitResolveReason ?? "none"})`),
  );
  v.push(
    sameCommit(buildInfo.declaredGitCommit, staleStamp)
      ? pass("real the lie arrived intact", staleStamp, buildInfo.declaredGitCommit)
      : fail("real the lie arrived intact", staleStamp, buildInfo.declaredGitCommit, "GIT_COMMIT did not reach the Dockerfile ARG, so precedence was never tested"),
  );
  v.push(
    buildInfo.staleStampDetected === true
      ? pass("real staleStampDetected", true, buildInfo.staleStampDetected)
      : fail("real staleStampDetected", true, buildInfo.staleStampDetected, "compose passed a stale .env stamp and the image agreed with it"),
  );

  if (!artifactBytes) {
    v.push(unverified("real artifact hash is of the shipped bytes", "sha256 of /repo/.../index.mjs", "dist not copied", "the api-build dist was not extracted, so the hash is trusted, not checked"));
  } else {
    const actual = createHash("sha256").update(artifactBytes).digest("hex").slice(0, 16);
    v.push(
      buildInfo.artifactSha256 === actual
        ? pass("real artifact hash is of the shipped bytes", actual, buildInfo.artifactSha256)
        : fail("real artifact hash is of the shipped bytes", actual, buildInfo.artifactSha256, "the identity hashes bytes that are not the bytes the image carries"),
    );
  }
  return { verdicts: v, status: grade(v) };
}

const defaultRun = (cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, { encoding: "utf8", ...opts });
  return {
    status: r.status === null ? -1 : r.status,
    stdout: r.stdout || "",
    stderr: r.stderr || "",
    error: r.error ? String(r.error.message || r.error) : null,
  };
};

/** Docker's absence is a fact to report, never a green tick. */
export function dockerInfo(run) {
  const v = run("docker", ["version", "--format", "{{.Server.Version}}\t{{.Client.Version}}"], { timeout: 60_000 });
  if (v.error || v.status !== 0) {
    return { available: false, reason: (v.stderr || v.stdout || v.error || "docker exited non-zero").trim().split(/\r?\n/)[0] };
  }
  const [server, client] = v.stdout.trim().split("\t");
  return { available: true, server: server || "unknown", client: client || "unknown" };
}

/**
 * The host checkout must be a real clone. In a linked worktree `.git` is a
 * pointer FILE, so `.dockerignore` has nothing to re-include and every arm would
 * degrade for a reason that has nothing to do with the claim.
 */
export function gitLayout(root, lstat = lstatSync) {
  try {
    const st = lstat(path.join(root, ".git"));
    return st.isDirectory()
      ? { kind: "directory", note: "" }
      : { kind: "file", note: ".git is a pointer file (linked worktree or submodule): no HEAD or refs can enter any build context from here" };
  } catch {
    return { kind: "absent", note: "no .git at all: this context cannot resolve a commit for any image built from it" };
  }
}

function buildImage({ run, tag, dockerfile, buildArgs, target, label, log }) {
  const args = ["build", "--quiet"];
  if (target) args.push("--target", target);
  if (dockerfile) args.push("-f", dockerfile);
  args.push("--tag", tag);
  for (const [k, value] of Object.entries(buildArgs)) args.push("--build-arg", `${k}=${value}`);
  args.push(".");
  const r = run("docker", args, { cwd: REPO_ROOT, timeout: 30 * 60_000, maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) {
    log(`${label} build FAILED (exit ${r.status})`);
    log(String(r.stderr || r.stdout).split(/\r?\n/).slice(-25).join("\n"));
    return { ok: false, imageId: null, failure: `${label} docker build exit ${r.status}` };
  }
  const imageId = String(r.stdout || "").trim().split(/\r?\n/).pop() || null;
  log(`${label} built ${imageId}`);
  return { ok: true, imageId, failure: null };
}

/**
 * `docker create` + `docker cp`: files out of an image, and no container ever
 * runs. A file that is not in the image is left for the grading to notice — an
 * absent arm is a verdict, not a crash.
 */
function copyOut({ run, imageId, pairs, outDir, log }) {
  const name = `probe-${process.pid}-${Date.now()}`;
  const created = run("docker", ["create", "--name", name, imageId], { timeout: 120_000 });
  if (created.status !== 0) {
    log(`docker create failed: ${String(created.stderr).split(/\r?\n/)[0]}`);
    return;
  }
  for (const [from, to] of pairs) {
    const dest = path.join(outDir, to);
    mkdirSync(path.dirname(dest), { recursive: true });
    const r = run("docker", ["cp", `${name}:${from}`, dest], { timeout: 300_000 });
    if (r.status !== 0) log(`  docker cp ${from} -> exit ${r.status} ${String(r.stderr).trim().split(/\r?\n/)[0]}`);
  }
  run("docker", ["rm", "-f", name], { timeout: 120_000 });
}

const USAGE = `docker-build-identity — prove an image names its own commit, with a real build

  node scripts/docker-build-identity.mjs                      # context tier
  node scripts/docker-build-identity.mjs --tier all           # + production api-build
  node scripts/docker-build-identity.mjs --json=proof.json    # machine-readable evidence

Exit 0 ${PASS}, 1 ${FAIL}, 2 ${UNVERIFIED} (ran, but an arm could not be exercised),
3 ${UNAVAILABLE} (no Docker here). Only 0 may be quoted as proof.`;

export async function main(argv = process.argv.slice(2), {
  run = defaultRun,
  log = (line) => process.stdout.write(line + "\n"),
  lstat = lstatSync,
} = {}) {
  const args = parseArgs(argv);
  if (args.help || args.h) {
    log(USAGE);
    return 0;
  }
  const tier = String(args.tier || "context").toLowerCase();
  const wantReal = tier === "real" || tier === "all";
  const wantContext = tier === "context" || tier === "all";

  const docker = dockerInfo(run);
  if (!docker.available) {
    log(`${UNAVAILABLE}: no usable Docker on this machine (${docker.reason})`);
    log(`   The build-identity claim is UNPROVEN here. scripts/buildIdentity.test.mjs pins the text`);
    log(`   of .dockerignore and the Dockerfile; only a real build can pin the context.`);
    return exitCode[UNAVAILABLE];
  }
  log(`docker server=${docker.server} client=${docker.client}`);

  const layout = gitLayout(REPO_ROOT, lstat);
  const head = run("git", ["rev-parse", "HEAD"], { cwd: REPO_ROOT, timeout: 30_000 });
  if (head.status !== 0 || layout.kind !== "directory") {
    log(`${UNVERIFIED}: the checkout cannot supply a context. ${layout.note || String(head.stderr).trim()}`);
    return exitCode[UNVERIFIED];
  }
  const headSha = String(head.stdout).trim();
  const staleStamp = staleStampFor(headSha);
  log(`checkout HEAD ${headSha} — feeding in the false stamp ${staleStamp}`);

  const outDir = mkdtempSync(path.join(tmpdir(), "care-build-identity-"));
  const report = { generatedAt: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"), docker, headSha, staleStamp, tier, tiers: {} };
  const statuses = [];

  try {
    if (wantContext) {
      const tag = `care-build-identity-probe:context-${process.pid}`;
      const built = buildImage({
        run,
        tag,
        dockerfile: PROBE_DOCKERFILE,
        buildArgs: { STALE_COMMIT: staleStamp, REAL_COMMIT: headSha },
        label: "context-tier",
        log,
      });
      if (built.ok) {
        copyOut({
          run,
          imageId: tag,
          outDir,
          log,
          pairs: [
            ["/out/context.tsv", "context.tsv"],
            ["/out/a.json", "a.json"],
            ["/out/b.json", "b.json"],
            ["/out/c.json", "c.json"],
            ["/out/d.json", "d.json"],
          ],
        });
        const manifest = parseContextManifest(readFileSyncSafe(path.join(outDir, "context.tsv")));
        const arms = { a: readArm(outDir, "a"), b: readArm(outDir, "b"), c: readArm(outDir, "c"), d: readArm(outDir, "d") };
        const result = evaluateProbe({ manifest, arms, headSha, staleStamp });
        report.tiers.context = { ...result, manifest, arms };
        statuses.push(result.status);
        printVerdicts(result, log);
      } else {
        statuses.push(FAIL);
      }
      run("docker", ["rmi", "-f", tag], { timeout: 120_000 });
    }

    if (wantReal) {
      const tag = `care-build-identity-probe:real-${process.pid}`;
      const built = buildImage({
        run,
        tag,
        dockerfile: "Dockerfile",
        target: "api-build",
        buildArgs: { GIT_COMMIT: staleStamp, GIT_BRANCH: "probe-branch", GIT_TAG: "probe-tag" },
        label: "real-tier",
        log,
      });
      if (built.ok) {
        copyOut({
          run,
          imageId: tag,
          outDir,
          log,
          pairs: [
            ["/repo/build-info.json", "real-build-info.json"],
            ["/repo/artifacts/api-server/dist/index.mjs", "real-index.mjs"],
          ],
        });
        let bytes = null;
        try {
          bytes = readFileSync(path.join(outDir, "real-index.mjs"));
        } catch {
          bytes = null;
        }
        const buildInfo = readArm(outDir, "real-build-info");
        // `bytes` is null exactly when the copy did not produce a file, which is
        // what the grader turns into an UNVERIFIED arm.
        const result = evaluateRealBuild({ buildInfo, headSha, staleStamp, artifactBytes: bytes });
        report.tiers.real = { ...result, buildInfo, artifactHashed: !!bytes };
        statuses.push(result.status);
        printVerdicts(result, log);
      } else {
        statuses.push(FAIL);
      }
      run("docker", ["rmi", "-f", tag], { timeout: 120_000 });
    }
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }

  const status = statuses.includes(FAIL) ? FAIL : statuses.includes(UNVERIFIED) ? UNVERIFIED : statuses.includes(PASS) ? PASS : UNAVAILABLE;
  const codePath = typeof args.json === "string" ? args.json : null;
  if (codePath) {
    const target = path.resolve(REPO_ROOT, codePath);
    // The proof is written even when the verdict is red, because a failure with no
    // artefact is a failure nobody can read the reason for. `tmp/` is gitignored,
    // so it does not exist in a fresh checkout.
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, JSON.stringify(report, null, 2) + "\n");
    log(`proof written to ${codePath}`);
  }
  log(`${status}: ${statuses.length ? `${statuses.length} tier(s) graded` : "no tier ran"} (exit ${exitCode[status]})`);
  return exitCode[status];
}

function readFileSyncSafe(file) {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

function printVerdicts(result, log) {
  for (const v of result.verdicts) {
    const mark = v.status === "pass" ? "ok  " : v.status === "fail" ? "FAIL" : "  ? ";
    log(`  ${mark} ${v.name}: expected ${fmt(v.expected)}, got ${fmt(v.actual)}${v.note ? ` — ${v.note}` : ""}`);
  }
}

const fmt = (value) => (typeof value === "string" ? (/^[0-9a-f]{7,}$/i.test(value) ? value.slice(0, 12) : value) : JSON.stringify(value));

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (invokedDirectly) main().then((code) => { process.exitCode = code; });
