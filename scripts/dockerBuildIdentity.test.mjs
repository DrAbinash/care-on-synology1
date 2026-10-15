import { describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";

import { SOURCE_DECLARED, SOURCE_GIT } from "./build-identity.mjs";
import {
  EXIT_CODES,
  FAIL,
  PASS,
  PROBE_DOCKERFILE,
  REPO_ROOT,
  STALE_STAMP,
  UNAVAILABLE,
  UNVERIFIED,
  dockerInfo,
  evaluateProbe,
  evaluateRealBuild,
  gitLayout,
  main,
  parseContextManifest,
  staleStampFor,
} from "./docker-build-identity.mjs";

const HEAD = "3f0441073f0441073f0441073f0441073f044107";
const STALE = staleStampFor(HEAD);
const yml = readFileSync(path.join(REPO_ROOT, ".github/workflows/ci.yml"), "utf8");
const identityJob = yml.split(/\n  (?=[a-z])/).find((c) => c.includes("docker-build-identity.mjs")) || "";

const identity = (over = {}) => ({
  commit: HEAD,
  identitySource: SOURCE_GIT,
  declaredGitCommit: STALE,
  staleStampDetected: true,
  gitResolveReason: null,
  artifactSha256: "a".repeat(16),
  ...over,
});

/**
 * The context manifest of a normal clone: symbolic HEAD, one loose ref, no
 * objects. `over` replaces one field, which is how a single condition of the
 * build gets changed without rewriting the whole file.
 */
function manifest(over = {}) {
  const base = {
    "context-files": ".git .git/HEAD .git/refs",
    "head-first-line": "ref: refs/heads/main",
    "refs-loose-count": "1",
    "packed-refs-present": "no",
    "objects-present": "no",
    ...over,
  };
  // Written by a Linux `RUN`, read after a `docker cp` that may land on Windows:
  // the parser has to take either line ending.
  return parseContextManifest(Object.entries(base).map(([k, v]) => `${k}\t${v}`).join("\r\n"));
}

describe("staleStampFor", () => {
  it("hands in a stamp that cannot be the checkout's own", () => {
    expect(STALE).toBe(STALE_STAMP);
    expect(staleStampFor(HEAD)).toBe(STALE_STAMP);
    expect(staleStampFor(STALE_STAMP)).toBe("0123456789012345678901234567890123456789");
    expect(staleStampFor(STALE_STAMP.toUpperCase())).toBe("0123456789012345678901234567890123456789");
  });

  it("is 40 hex characters, because that is the shape compose bakes", () => {
    expect(STALE).toMatch(/^[0-9a-f]{40}$/);
  });
});

describe("parseContextManifest", () => {
  it("separates a symbolic HEAD from a detached one", () => {
    expect(manifest().symbolicHead).toBe(true);
    expect(manifest().detachedHead).toBe(false);
    const detached = parseContextManifest(`head-first-line\t${HEAD}\nrefs-loose-count\t0`);
    expect(detached.symbolicHead).toBe(false);
    expect(detached.detachedHead).toBe(true);
  });

  it("reads absence as absence, never as a zero-length truth", () => {
    const empty = parseContextManifest("");
    expect(empty.headFirstLine).toBe("");
    expect(empty.refsLooseCount).toBe(0);
    expect(empty.objectsPresent).toBe(false);
    expect(parseContextManifest("objects-present\tYES").objectsPresent).toBe(true);
  });

  it("survives a manifest with unrelated lines", () => {
    expect(parseContextManifest("nonsense line\nhead-first-line\tref: refs/heads/x").headFirstLine).toBe("ref: refs/heads/x");
  });
});

describe("evaluateProbe — the arms that decide the claim", () => {
  const good = {
    a: identity(),
    b: identity({ declaredGitCommit: HEAD, staleStampDetected: false }),
    c: identity({ commit: STALE, identitySource: SOURCE_DECLARED, gitResolveReason: "ref refs/heads/main resolves in neither a loose file nor packed-refs" }),
    d: identity({ commit: STALE, identitySource: SOURCE_DECLARED, gitResolveReason: "no HEAD file" }),
  };

  it("passes the whole set only when the metadata outranks the argument four ways", () => {
    const r = evaluateProbe({ manifest: manifest(), arms: good, headSha: HEAD, staleStamp: STALE });
    expect(r.status).toBe(PASS);
    expect(r.verdicts.every((v) => v.status === "pass")).toBe(true);
  });

  it("FAILS the exact clinic defect: the image reports the stamp it was handed", () => {
    const lying = { ...good, a: identity({ commit: STALE, identitySource: SOURCE_DECLARED, staleStampDetected: false, gitResolveReason: "no HEAD file" }) };
    const r = evaluateProbe({ manifest: manifest(), arms: lying, headSha: HEAD, staleStamp: STALE });
    expect(r.status).toBe(FAIL);
    const names = r.verdicts.filter((v) => v.status === "fail").map((v) => v.name);
    expect(names).toContain("A commit is the checkout");
    expect(names).toContain("A identitySource");
  });

  it("FAILS a resolver that calls every build stale, which would make arm A meaningless", () => {
    const alwaysStale = { ...good, b: identity({ declaredGitCommit: HEAD, staleStampDetected: true }) };
    const r = evaluateProbe({ manifest: manifest(), arms: alwaysStale, headSha: HEAD, staleStamp: STALE });
    expect(r.status).toBe(FAIL);
    expect(r.verdicts.find((v) => v.name.startsWith("B agreeing stamp")).status).toBe("fail");
  });

  it("FAILS when the lie never arrived, because then arm A tested nothing", () => {
    const r = evaluateProbe({
      manifest: manifest(),
      arms: { ...good, a: identity({ declaredGitCommit: null }) },
      headSha: HEAD,
      staleStamp: STALE,
    });
    expect(r.status).toBe(FAIL);
    expect(r.verdicts.find((v) => v.name.startsWith("A the lie arrived")).note).toContain("precedence");
  });

  it("FAILS when hiding the refs does not change the answer", () => {
    const r = evaluateProbe({ manifest: manifest(), arms: { ...good, c: identity() }, headSha: HEAD, staleStamp: STALE });
    expect(r.status).toBe(FAIL);
    expect(r.verdicts.find((v) => v.name.startsWith("C refs removed")).status).toBe("fail");
  });

  it("says UNVERIFIED rather than PASS when the checkout has no refs to hide", () => {
    const r = evaluateProbe({ manifest: manifest({ "refs-loose-count": "0", "packed-refs-present": "no" }), arms: good, headSha: HEAD, staleStamp: STALE });
    expect(r.status).toBe(UNVERIFIED);
    expect(r.verdicts.find((v) => v.name.startsWith("C refs removed")).status).toBe("unverified");
  });

  it("says UNVERIFIED when HEAD is detached, because refs are not what resolved it", () => {
    const r = evaluateProbe({ manifest: manifest({ "head-first-line": HEAD }), arms: good, headSha: HEAD, staleStamp: STALE });
    expect(r.status).toBe(UNVERIFIED);
    expect(r.verdicts.find((v) => v.name.startsWith("C refs removed")).note).toContain("resolves without refs");
  });

  it("FAILS when hiding HEAD leaves the identity standing, and when the objects leaked into the context", () => {
    const dSurvives = evaluateProbe({ manifest: manifest(), arms: { ...good, d: identity() }, headSha: HEAD, staleStamp: STALE });
    expect(dSurvives.verdicts.find((v) => v.name.startsWith("D HEAD removed")).status).toBe("fail");
    const bloated = evaluateProbe({ manifest: manifest({ "objects-present": "YES" }), arms: good, headSha: HEAD, staleStamp: STALE });
    expect(bloated.status).toBe(FAIL);
    expect(bloated.verdicts.find((v) => v.name.startsWith("objects stay out")).actual).toBe("present");
  });

  it("grades a missing arm as FAIL, not as a silent skip", () => {
    const r = evaluateProbe({ manifest: manifest(), arms: { a: good.a, b: null, c: good.c, d: good.d }, headSha: HEAD, staleStamp: STALE });
    expect(r.status).toBe(FAIL);
    expect(r.verdicts).toHaveLength(1);
    expect(r.verdicts[0].name).toContain("B agreeing stamp");
    expect(r.verdicts[0].actual).toBe("absent");
  });
});

describe("evaluateRealBuild — the production Dockerfile tier", () => {
  const bytes = Buffer.from("console.log('shipped')");
  const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 16);

  it("passes only when the shipped bytes hash to the recorded value", () => {
    const r = evaluateRealBuild({ buildInfo: identity({ artifactSha256: hash }), headSha: HEAD, staleStamp: STALE, artifactBytes: bytes });
    expect(r.status).toBe(PASS);
  });

  it("FAILS when the identity hashes bytes other than the ones the image carries", () => {
    const r = evaluateRealBuild({ buildInfo: identity({ artifactSha256: "0".repeat(16) }), headSha: HEAD, staleStamp: STALE, artifactBytes: bytes });
    expect(r.status).toBe(FAIL);
    expect(r.verdicts.find((v) => v.name.startsWith("real artifact hash")).status).toBe("fail");
  });

  it("is UNVERIFIED, never PASS, when the dist was not extracted", () => {
    const r = evaluateRealBuild({ buildInfo: identity(), headSha: HEAD, staleStamp: STALE, artifactBytes: null });
    expect(r.status).toBe(UNVERIFIED);
  });

  it("FAILS when the compose-declared stamp won", () => {
    const r = evaluateRealBuild({
      buildInfo: identity({ commit: STALE, identitySource: SOURCE_DECLARED, staleStampDetected: false }),
      headSha: HEAD,
      staleStamp: STALE,
      artifactBytes: bytes,
    });
    expect(r.status).toBe(FAIL);
    expect(r.verdicts.find((v) => v.name === "real staleStampDetected").status).toBe("fail");
  });

  it("grades a stage that never wrote an identity", () => {
    const r = evaluateRealBuild({ buildInfo: null, headSha: HEAD, staleStamp: STALE, artifactBytes: null });
    expect(r.status).toBe(FAIL);
    expect(r.verdicts[0].name).toBe("api-build build-info.json");
  });
});

describe("gitLayout", () => {
  it("refuses to prove anything from a linked worktree, where .git is a pointer file", () => {
    const lstat = (p) => (p.endsWith(".git") ? { isDirectory: () => false } : { isDirectory: () => true });
    const r = gitLayout("/repo", lstat);
    expect(r.kind).toBe("file");
    expect(r.note).toContain("pointer file");
  });

  it("accepts a real clone", () => {
    expect(gitLayout("/repo", () => ({ isDirectory: () => true })).kind).toBe("directory");
  });
});

describe("dockerInfo", () => {
  it("reports absence with the first line of the reason", () => {
    const r = dockerInfo(() => ({ status: 1, stdout: "", stderr: "Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?", error: null }));
    expect(r.available).toBe(false);
    expect(r.reason).toContain("Is the docker daemon running");
  });

  it("treats an ENOENT spawn as absence", () => {
    expect(dockerInfo(() => ({ status: -1, stdout: "", stderr: "", error: "spawnSync docker ENOENT" })).available).toBe(false);
  });

  it("reads server and client from one tab-separated format string", () => {
    const r = dockerInfo(() => ({ status: 0, stdout: "24.0.2\t27.1.1\n", stderr: "", error: null }));
    expect(r).toEqual({ available: true, server: "24.0.2", client: "27.1.1" });
  });
});

describe("the CLI never reports success without Docker", () => {
  it("exits non-zero and says the claim is unproven", async () => {
    const lines = [];
    const code = await main([], {
      run: () => ({ status: 1, stdout: "", stderr: "command not found: docker", error: "spawnSync docker ENOENT" }),
      log: (l) => lines.push(l),
      lstat: () => ({ isDirectory: () => true }),
    });
    expect(code).toBe(3);
    expect(lines.join("\n")).toContain(UNAVAILABLE);
    expect(lines.join("\n")).toContain("UNPROVEN");
    expect(code).not.toBe(0);
  });

  it("exits UNVERIFIED when the checkout cannot supply a context", async () => {
    const lines = [];
    const run = (cmd) => (cmd === "docker" ? { status: 0, stdout: "24.0.2\t24.0.2\n", stderr: "", error: null } : { status: 0, stdout: HEAD + "\n", stderr: "", error: null });
    const code = await main([], { run, log: (l) => lines.push(l), lstat: () => ({ isDirectory: () => false }) });
    expect(code).toBe(2);
    expect(lines.join("\n")).toContain("pointer file");
  });
});

/**
 * A scripted `run` stands in for Docker so the CLI plumbing — build arguments,
 * the files copied out, cleanup, grading, exit code — is exercised without
 * Docker. This is NOT evidence about `.dockerignore`: only the `build-identity`
 * CI job, which runs a real `docker build`, is. The arms below are exactly what
 * the probe Dockerfile writes on a normal clone.
 */
function fakeDocker({ staleStamp = STALE, headSha = HEAD, missing = [] } = {}) {
  const calls = [];
  const distBytes = Buffer.from("console.log('the bytes the image ships')");
  const outByRemotePath = {
    "/out/a.json": identity({ declaredGitCommit: staleStamp, staleStampDetected: true }),
    "/out/b.json": identity({ declaredGitCommit: headSha, staleStampDetected: false }),
    "/out/c.json": identity({ commit: staleStamp, identitySource: SOURCE_DECLARED }),
    "/out/d.json": identity({ commit: staleStamp, identitySource: SOURCE_DECLARED }),
    "/out/context.tsv": [
      "context-files\t.git .git/HEAD .git/refs",
      "head-first-line\tref: refs/heads/main",
      "refs-loose-count\t1",
      "packed-refs-present\tno",
      "objects-present\tno",
    ].join("\n"),
    "/repo/build-info.json": identity({
      declaredGitCommit: staleStamp,
      staleStampDetected: true,
      artifactSha256: createHash("sha256").update(distBytes).digest("hex").slice(0, 16),
    }),
    "/repo/artifacts/api-server/dist/index.mjs": distBytes.toString("utf8"),
  };
  const run = (cmd, args, opts = {}) => {
    calls.push([cmd, ...args].join(" "));
    if (cmd === "git") return { status: 0, stdout: headSha + "\n", stderr: "", error: null };
    if (args[0] === "version") return { status: 0, stdout: "24.0.2\t24.0.2\n", stderr: "", error: null };
    if (args[0] === "build") {
      const wanted = args.includes(PROBE_DOCKERFILE) || args.includes("Dockerfile");
      return wanted
        ? { status: 0, stdout: "sha256:deadbeef\n", stderr: "", error: null }
        : { status: 1, stdout: "", stderr: "no such file", error: null };
    }
    if (args[0] === "cp") {
      const dest = args[2];
      const remote = args[1].split(":").slice(1).join(":");
      const key = path.posix.basename(remote);
      if (missing.includes(key)) return { status: 1, stdout: "", stderr: `Error: no such file ${args[1]}`, error: null };
      const value = outByRemotePath[remote];
      if (value === undefined) return { status: 1, stdout: "", stderr: `unexpected cp ${remote}`, error: null };
      writeFileSync(dest, typeof value === "string" ? value : JSON.stringify(value));
      return { status: 0, stdout: "", stderr: "", error: null };
    }
    return { status: 0, stdout: "", stderr: "", error: null };
  };
  return { run, calls };
}

describe("the CLI wires a real build end to end", () => {
  it("builds from the repo root with the probe file, extracts five evidence files, and cleans up after itself", async () => {
    const f = fakeDocker();
    const lines = [];
    const code = await main(["--tier", "context"], {
      run: f.run,
      log: (l) => lines.push(l),
      lstat: () => ({ isDirectory: () => true }),
    });
    const text = lines.join("\n");
    expect(code).toBe(0);
    expect(text).toContain(`${PASS}:`);
    expect(f.calls.find((c) => c.startsWith("docker build"))).toContain(PROBE_DOCKERFILE);
    expect(f.calls.find((c) => c.startsWith("docker build"))).toContain("--build-arg");
    expect(f.calls.filter((c) => c.startsWith("docker cp"))).toHaveLength(5);
    expect(f.calls.some((c) => c.startsWith("docker rm -f"))).toBe(true);
    expect(f.calls.some((c) => c.startsWith("docker rmi -f"))).toBe(true);
  });

  it("writes the machine-readable proof where it is asked, with the stamp it lied about", async () => {
    const f = fakeDocker();
    const dir = mkdtempSync(path.join(tmpdir(), "proof-"));
    const file = path.join(dir, "p.json");
    try {
      const code = await main([`--tier=context`, `--json=${file}`], {
        run: f.run,
        log: () => {},
        lstat: () => ({ isDirectory: () => true }),
      });
      expect(code).toBe(0);
      const j = JSON.parse(readFileSync(file, "utf8"));
      expect(j.headSha).toBe(HEAD);
      expect(j.staleStamp).toBe(STALE);
      expect(j.tiers.context.status).toBe(PASS);
      expect(j.tiers.context.arms.a.declaredGitCommit).toBe(STALE);
      expect(j.docker.server).toBe("24.0.2");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("is red, not yellow, when an arm produced no evidence", async () => {
    const f = fakeDocker({ missing: ["c.json"] });
    const lines = [];
    const code = await main(["--tier", "context"], { run: f.run, log: (l) => lines.push(l), lstat: () => ({ isDirectory: () => true }) });
    expect(code).toBe(1);
    expect(lines.join("\n")).toContain(FAIL);
    expect(lines.join("\n")).toContain("C refs removed");
  });

  it("is UNVERIFIED when the checkout is detached, because arm C then proves nothing", async () => {
    const f = fakeDocker();
    const code = await main(["--tier", "context"], {
      run: (cmd, args, opts) => {
        const r = f.run(cmd, args, opts);
        if (args[0] === "cp" && args[2].endsWith("context.tsv")) {
          writeFileSync(args[2], `head-first-line\t${HEAD}\nrefs-loose-count\t1\npacked-refs-present\tyes\nobjects-present\tno`);
        }
        return r;
      },
      log: () => {},
      lstat: () => ({ isDirectory: () => true }),
    });
    expect(code).toBe(2);
  });

  it("never runs the expensive tier unless it is asked for", async () => {
    const f = fakeDocker();
    await main(["--tier", "context"], { run: f.run, log: () => {}, lstat: () => ({ isDirectory: () => true }) });
    expect(f.calls.filter((c) => c.includes("--target api-build"))).toEqual([]);
  });

  it("--tier real builds the production Dockerfile and re-hashes the bytes it copied out", async () => {
    const f = fakeDocker();
    const lines = [];
    const code = await main(["--tier", "all"], { run: f.run, log: (l) => lines.push(l), lstat: () => ({ isDirectory: () => true }) });
    const build = f.calls.find((c) => c.includes("--target api-build"));
    expect(build).toContain("--build-arg GIT_COMMIT=" + STALE);
    expect(build).toContain("--build-arg GIT_BRANCH=probe-branch");
    expect(build).toContain("-f Dockerfile");
    expect(f.calls.some((c) => c.includes("/repo/artifacts/api-server/dist/index.mjs"))).toBe(true);
    expect(lines.join("\n")).toContain(`${PASS}: 2 tier(s) graded`);
    expect(code).toBe(0);
  });

  it("grades the real tier UNVERIFIED when the dist never came out of the image", async () => {
    const f = fakeDocker({ missing: ["index.mjs"] });
    const lines = [];
    const code = await main(["--tier", "real"], { run: f.run, log: (l) => lines.push(l), lstat: () => ({ isDirectory: () => true }) });
    expect(code).toBe(2);
    expect(lines.join("\n")).toContain("dist not copied");
  });
});

describe("the probe Dockerfile is a probe, not a second product build", () => {
  const file = path.join(REPO_ROOT, PROBE_DOCKERFILE);
  const text = readFileSync(file, "utf8");
  // Comments are documentation and will happily name the things the probe must
  // not do; only the instructions count.
  const code = text.split(/\r?\n/).filter((l) => !l.trim().startsWith("#")).join("\n");

  it("is in the context path that the claim needs", () => {
    expect(existsSync(file)).toBe(true);
    expect(code).toContain("COPY . .");
  });

  it("runs the production resolver rather than re-implementing it", () => {
    expect(code.match(/node scripts\/build-identity\.mjs/g)).toHaveLength(4);
    expect(code).not.toContain("function resolveGitIdentity");
  });

  it("writes four arms, one per condition the claim depends on", () => {
    for (const arm of ["/out/a.json", "/out/b.json", "/out/c.json", "/out/d.json"]) expect(code).toContain(arm);
    expect(code).toContain("/out/context.tsv");
  });

  it("stays cheap: no package install, no bundle, no product stage", () => {
    expect(code).not.toMatch(/pnpm|npm install|esbuild/);
    expect(code).not.toMatch(/AS api\b/);
  });

  it("puts the hidden metadata back, so a later arm sees the same context", () => {
    expect(code).toContain(".git/refs.probe-hidden .git/refs");
    expect(code).toContain(".git/HEAD.probe-hidden .git/HEAD");
  });

  it("says which arm is which, because an unlabelled json file is not evidence", () => {
    for (const arm of ["Arm A", "Arm B", "Arm C", "Arm D"]) expect(text).toContain(arm);
  });
});

describe("CI runs the real build, so the proof is not left to a developer's machine", () => {
  // Only the `run:` lines are invocations; the job's prose names the script too,
  // and grepping prose is how a guard passes while the step it guards is gone.
  const invocations = identityJob.split(/\r?\n/).filter((l) => l.trimStart().startsWith("run:") && l.includes("docker-build-identity.mjs"));

  it("has a job that invokes the harness", () => {
    expect(identityJob).toBeTruthy();
    expect(invocations.length).toBeGreaterThanOrEqual(2);
    expect(invocations[0]).toContain("--tier context");
  });

  it("checks the checkout out to a branch ref first, because arm C is meaningless on a detached HEAD", () => {
    expect(identityJob).toContain("git checkout -B build-identity-probe");
    expect(identityJob.indexOf("git checkout -B build-identity-probe")).toBeLessThan(identityJob.indexOf("docker-build-identity.mjs --tier context"));
  });

  it("lets only exit 0 count, so UNAVAILABLE and UNVERIFIED cannot read as green", () => {
    expect(identityJob).not.toMatch(/continue-on-error:\s*true/);
    for (const line of invocations) {
      expect(line).not.toMatch(/\|\|/);
      expect(line).not.toMatch(/:\s*true\b/);
    }
  });

  it("writes machine-readable evidence from every invocation, not just from one of them", () => {
    // Asserted per command line, because with two steps in the job a `toContain`
    // on the whole block is satisfied by whichever one still has the flag — which
    // is exactly how "drop the proof file" survives a grep that looks careful.
    for (const line of invocations) expect(line).toMatch(/--json=tmp\/build-identity-\S+\.json/);
    expect(identityJob).toMatch(/path: tmp\/build-identity-\*\.json/);
  });

  it("runs the context tier unconditionally and gates the production build behind a request", () => {
    expect(identityJob).toMatch(/if: github\.event_name == 'workflow_dispatch'/);
    const realStep = identityJob.slice(identityJob.indexOf("if: github.event_name == 'workflow_dispatch'"));
    expect(realStep).toContain("--tier real");
    expect(identityJob.slice(0, identityJob.indexOf("--tier context"))).not.toMatch(/if: github\.event_name/);
  });

  it("keeps the workflow trigger that makes the production tier reachable", () => {
    expect(yml).toMatch(/^on:[\s\S]*workflow_dispatch/m);
  });
});

describe("the runbook documents the proof it tells anyone to run", () => {
  const doc = readFileSync(path.join(REPO_ROOT, "docs/CARE_ERP_DEPLOYMENT_RUNBOOK.md"), "utf8");

  it("states the same exit codes the harness returns", () => {
    // Compared as (verdict -> code) pairs, not as "the file contains 0, 1, 2, 3":
    // digits appear everywhere in a runbook, and a page that called UNAVAILABLE a
    // success would still contain a zero somewhere.
    const stated = {};
    for (const m of doc.matchAll(/\*\*(\d) (PASS|FAIL|UNVERIFIED|UNAVAILABLE)\*\*/g)) stated[m[2]] = Number(m[1]);
    expect(stated).toEqual(EXIT_CODES);
  });

  it("names both tiers and says which one costs a dependency install", () => {
    expect(doc).toContain("--tier context");
    expect(doc).toContain("--tier real");
    expect(doc).toContain("in-image `pnpm install`");
  });

  it("does not claim CI proves the expensive tier on every PR", () => {
    expect(doc).toContain("when the workflow is run by hand");
    expect(identityJob).toContain("--tier real");
  });

  it("warns about the one checkout layout that cannot carry an identity", () => {
    expect(doc).toMatch(/linked `git worktree`/);
    expect(doc).toMatch(/pointer file/);
  });

  it("keeps §12b's commands runnable as written", () => {
    // Every command the runbook shows, in full. A documented command that the
    // harness does not accept is worse than no documentation, because the operator
    // runs it on the clinic box and reads the failure as the clinic's fault.
    const documented = [...doc.matchAll(/`node scripts\/docker-build-identity\.mjs[^`]*`/g)].map((m) => m[0].slice(1, -1));
    expect(documented.length).toBeGreaterThanOrEqual(2);
    for (const cmd of documented) {
      expect(cmd).toMatch(/^node scripts\/docker-build-identity\.mjs( --tier (context|real))?$/);
      const tier = /--tier (\w+)/.exec(cmd)?.[1] ?? "context";
      expect(["context", "real", "all"]).toContain(tier);
    }
    expect(existsSync(path.join(REPO_ROOT, "scripts", "docker-build-identity.mjs"))).toBe(true);
  });
});

/**
 * The half of "disposable" that the happy-path tests cannot see. Every case here
 * fails against a version that cleans up only when each docker call answered 0 —
 * which is the version that leaves a container and an image on the NAS, the same
 * box whose disk headroom §12b warns about.
 */
describe("a tier that dies half-way still cleans up", () => {
  const lstat = () => ({ isDirectory: () => true });
  const quiet = () => {};

  const scripted = (failOn) => {
    const f = fakeDocker();
    const run = (cmd, args, opts = {}) => {
      const joined = [cmd, ...args].join(" ");
      if (failOn && failOn(joined)) throw new Error("harness: the daemon vanished mid-call");
      return f.run(cmd, args, opts);
    };
    return { run, calls: f.calls };
  };

  it("removes the container when the copy loop throws", async () => {
    const s = scripted((j) => j.startsWith("docker cp") && j.includes("b.json"));
    await expect(main(["--tier", "context"], { run: s.run, log: quiet, lstat })).rejects.toThrow("daemon vanished");
    expect(s.calls.filter((c) => c.startsWith("docker rm -f probe-"))).toHaveLength(1);
    expect(s.calls.filter((c) => c.startsWith("docker rmi -f care-build-identity-probe:"))).toHaveLength(1);
  });

  it("removes a container the daemon created but reported as failed", async () => {
    // A `docker create` that times out answers non-zero after the daemon has already
    // made the container. A cleaner registered on success leaks exactly this case.
    const f = fakeDocker();
    const run = (cmd, args, opts = {}) => (args[0] === "create"
      ? { status: -1, stdout: "", stderr: "timeout", error: null }
      : f.run(cmd, args, opts));
    const code = await main(["--tier", "context"], { run, log: quiet, lstat });
    expect(code).not.toBe(0);
    expect(f.calls.filter((c) => c.startsWith("docker rm -f probe-"))).toHaveLength(1);
    expect(f.calls.filter((c) => c.startsWith("docker rmi -f care-build-identity-probe:"))).toHaveLength(1);
  });

  it("removes the image even when the build itself is what failed", async () => {
    const f = fakeDocker();
    const run = (cmd, args, opts = {}) => (args[0] === "build"
      ? { status: 1, stdout: "", stderr: "step failed", error: null }
      : f.run(cmd, args, opts));
    const code = await main(["--tier", "context"], { run, log: quiet, lstat });
    expect(code).toBe(EXIT_CODES[FAIL]);
    expect(f.calls.filter((c) => c.startsWith("docker rmi -f care-build-identity-probe:"))).toHaveLength(1);
  });

  it("holds each build timeout under the CI step that waits for it", () => {
    // A hung build must print its own named verdict before the runner cancels the
    // step, or the reason is lost with the job. Each tier has its own budget, and a
    // missing pairing is a failure rather than a vacuous pass.
    const src = readFileSync(path.join(REPO_ROOT, "scripts", "docker-build-identity.mjs"), "utf8");
    // Read as adjacent lines rather than one multi-line regex: the working tree here
    // is CRLF, and a `\n` in a source-level regex is how such a guard silently
    // matches nothing.
    const source = src.split(/\r?\n/);
    const build = {};
    source.forEach((line, i) => {
      const label = /label: "(\w+)-tier"/.exec(line);
      const minutes = /timeoutMinutes: (\d+)/.exec(source[i + 1] || "");
      if (label && minutes) build[label[1]] = Number(minutes[1]);
    });
    const job = identityJob.split(/\r?\n/);
    const caps = {};
    job.forEach((line, i) => {
      const cap = /timeout-minutes: (\d+)/.exec(line);
      const step = /run: node scripts\/docker-build-identity\.mjs.*--tier (\w+)/.exec(job[i + 1] || "");
      if (cap && step) caps[step[1]] = Number(cap[1]);
    });
    expect(Object.keys(build).sort()).toEqual(["context", "real"]);
    expect(Object.keys(caps).sort()).toEqual(["context", "real"]);
    for (const tier of ["context", "real"]) {
      expect(build[tier], `${tier} build must finish inside its step`).toBeLessThan(caps[tier]);
    }
  });

});

describe("the proof exists for the answers nobody wants", () => {
  it("writes a machine-readable abstain when there is no Docker", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "proof-absent-"));
    const file = path.join(dir, "context.json");
    try {
      const run = (cmd, args) => (args && args[0] === "version"
        ? { status: 1, stdout: "", stderr: "Cannot connect to the Docker daemon", error: null }
        : { status: 0, stdout: "", stderr: "", error: null });
      const code = await main([`--tier=context`, `--json=${file}`], { run, log: () => {}, lstat: () => ({ isDirectory: () => true }) });
      expect(code).toBe(EXIT_CODES[UNAVAILABLE]);
      const proof = JSON.parse(readFileSync(file, "utf8"));
      expect(proof.verdict).toBe(UNAVAILABLE);
      expect(proof.exitCode).toBe(3);
      expect(proof.abstain).toMatch(/no usable Docker/);
      expect(proof.tiers).toEqual({});
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("writes a machine-readable abstain for a pointer-file .git", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "proof-pointer-"));
    const file = path.join(dir, "context.json");
    try {
      const f = fakeDocker();
      const code = await main([`--tier=context`, `--json=${file}`], { run: f.run, log: () => {}, lstat: () => ({ isDirectory: () => false }) });
      expect(code).toBe(EXIT_CODES[UNVERIFIED]);
      const proof = JSON.parse(readFileSync(file, "utf8"));
      expect(proof.verdict).toBe(UNVERIFIED);
      expect(proof.abstain).toMatch(/pointer file/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe("the arms that decide the claim — the two that used to be decoration", () => {
  const good = {
    a: identity(),
    b: identity({ declaredGitCommit: HEAD, staleStampDetected: false }),
    c: identity({ commit: STALE, identitySource: SOURCE_DECLARED }),
    d: identity({ commit: STALE, identitySource: SOURCE_DECLARED }),
  };

  it("fails arm D when HEAD was hidden and the answer is neither the checkout nor the stamp", () => {
    // Arm D used to read only `identitySource`, so any label of "declared" passed it
    // — including a build that invented a commit nobody handed it.
    const invented = { ...good, d: identity({ commit: "9".repeat(40), identitySource: SOURCE_DECLARED }) };
    const r = evaluateProbe({ manifest: manifest(), arms: invented, headSha: HEAD, staleStamp: STALE });
    expect(r.status).toBe(FAIL);
    expect(r.verdicts.find((v) => v.name === "D falls back to the declared stamp").status).toBe("fail");
  });

  it("fails the objects promise when the context manifest never arrived", () => {
    // `objects-present` defaults to false, so a `docker cp` that silently failed used
    // to hand the one arm that measures the context a pass for the cost of nothing.
    const r = evaluateProbe({ manifest: parseContextManifest(""), arms: good, headSha: HEAD, staleStamp: STALE });
    expect(r.status).toBe(FAIL);
    expect(r.verdicts.find((v) => v.name === "objects stay out of the context").status).toBe("fail");
  });
});
