import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  SOURCE_DECLARED,
  SOURCE_GIT,
  SOURCE_UNKNOWN,
  artifactSha,
  composeIdentity,
  readGitHead,
  refCommit,
  resolveGitIdentity,
  sameCommit,
} from "./build-identity.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(HERE, "build-identity.mjs");

const SHA_A = "1111111111111111111111111111111111111111";
const SHA_B = "2222222222222222222222222222222222222222";

let root;

/** A checkout's .git directory, written the way git writes it. */
function makeGitDir(name, { head, loose = null, packed = null } = {}) {
  const dir = path.join(root, name);
  const git = name.endsWith(".git") ? dir : path.join(dir, ".git");
  mkdirSync(git, { recursive: true });
  if (head !== undefined) writeFileSync(path.join(git, "HEAD"), head);
  if (loose) {
    const refFile = path.join(git, ...loose.ref.split("/"));
    mkdirSync(path.dirname(refFile), { recursive: true });
    writeFileSync(refFile, loose.sha + "\n");
  }
  if (packed) writeFileSync(path.join(git, "packed-refs"), packed);
  return git;
}

beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), "build-identity-"));
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("readGitHead / refCommit", () => {
  it("reads a symbolic HEAD as a ref, not a commit", () => {
    const git = makeGitDir("sym", { head: "ref: refs/heads/main\n" });
    expect(readGitHead(git)).toEqual({ ref: "refs/heads/main", commit: null, reason: null });
  });

  it("reads a detached HEAD as the commit itself", () => {
    const git = makeGitDir("detached", { head: SHA_A + "\n" });
    const head = readGitHead(git);
    expect(head.commit).toBe(SHA_A);
    expect(head.ref).toBeNull();
  });

  it("resolves a loose ref", () => {
    const git = makeGitDir("loose", {
      head: "ref: refs/heads/main\n",
      loose: { ref: "refs/heads/main", sha: SHA_B },
    });
    expect(refCommit(git, "refs/heads/main")).toBe(SHA_B);
  });

  it("falls through to packed-refs when the loose ref was packed away", () => {
    // Real packed-refs on the NAS hold every branch, so the requested ref is
    // essentially never the first line: picking whichever line comes first would
    // name some other branch's commit and still call it build-context-git.
    const git = makeGitDir("packed", {
      head: "ref: refs/heads/main\n",
      packed: "# pack-refs with: peeled fully-peeled sorted \n"
        + `${SHA_B} refs/heads/cursor/stale-branch\n`
        + `${SHA_A} refs/heads/main\n`
        + `^${SHA_B} refs/tags/v1\n`,
    });
    expect(refCommit(git, "refs/heads/main")).toBe(SHA_A);
    expect(refCommit(git, "refs/heads/cursor/stale-branch")).toBe(SHA_B);
    expect(refCommit(git, "refs/heads/not-here-at-all")).toBeNull();
  });

  it("does not mistake a peeled tag line for a ref", () => {
    const git = makeGitDir("peeled", {
      head: "ref: refs/heads/main\n",
      packed: `^${SHA_A} refs/heads/main\n`,
    });
    expect(refCommit(git, "refs/heads/main")).toBeNull();
  });

  it("reports a missing HEAD instead of guessing", () => {
    const git = makeGitDir("empty-git", {});
    expect(readGitHead(git).reason).toBe("no HEAD file");
  });
});

describe("resolveGitIdentity", () => {
  it("names the branch a ref implies", () => {
    const git = makeGitDir("branch", {
      head: "ref: refs/heads/deploy\n",
      loose: { ref: "refs/heads/deploy", sha: SHA_A },
    });
    const identity = resolveGitIdentity(git);
    expect(identity).toMatchObject({ commit: SHA_A, branch: "deploy", detached: false });
  });

  it("says detached rather than inventing a branch", () => {
    const git = makeGitDir("detached2", { head: SHA_A + "\n" });
    expect(resolveGitIdentity(git)).toMatchObject({ commit: SHA_A, branch: null, detached: true });
  });

  it("explains a ref that resolves nowhere", () => {
    const git = makeGitDir("unresolved", { head: "ref: refs/heads/main\n" });
    const identity = resolveGitIdentity(git);
    expect(identity.commit).toBeNull();
    expect(identity.reason).toContain("refs/heads/main");
  });
});

describe("sameCommit", () => {
  it("matches a short stamp against a full SHA by shared prefix", () => {
    expect(sameCommit(SHA_A.slice(0, 8), SHA_A)).toBe(true);
    expect(sameCommit(SHA_A.slice(0, 8).toLowerCase(), SHA_A.toUpperCase())).toBe(true);
  });

  it("refuses to match on a prefix too short to mean anything", () => {
    expect(sameCommit("111111", SHA_A)).toBe(false);
    expect(sameCommit(null, SHA_A)).toBe(false);
    expect(sameCommit("unknown", SHA_A)).toBe(false);
  });
});

describe("artifactSha", () => {
  it("hashes the bytes on disk, so a changed artifact changes the answer", () => {
    const file = path.join(root, "index.mjs");
    writeFileSync(file, "console.log(1)");
    const first = artifactSha(file);
    expect(first).toBe(createHash("sha256").update("console.log(1)").digest("hex").slice(0, 16));
    writeFileSync(file, "console.log(2)");
    expect(artifactSha(file)).not.toBe(first);
  });

  it("is null when there is nothing to hash — never a placeholder", () => {
    expect(artifactSha(path.join(root, "nope.js"))).toBeNull();
    expect(artifactSha(null)).toBeNull();
  });
});

describe("composeIdentity", () => {
  it("reports the commit the context proves, and flags the stale stamp", () => {
    const git = makeGitDir("stale", {
      head: "ref: refs/heads/main\n",
      loose: { ref: "refs/heads/main", sha: SHA_A },
    });
    const identity = composeIdentity({ gitDir: git, declaredCommit: "2d51e8d7", versionFile: path.join(root, "none.json") });
    expect(identity.commit).toBe(SHA_A);
    expect(identity.identitySource).toBe(SOURCE_GIT);
    expect(identity.declaredGitCommit).toBe("2d51e8d7");
    expect(identity.staleStampDetected).toBe(true);
  });

  it("does not call a stamp stale when it agrees with the metadata", () => {
    const git = makeGitDir("agree", {
      head: "ref: refs/heads/main\n",
      loose: { ref: "refs/heads/main", sha: SHA_A },
    });
    const identity = composeIdentity({ gitDir: git, declaredCommit: SHA_A.slice(0, 8), versionFile: path.join(root, "none.json") });
    expect(identity.staleStampDetected).toBe(false);
    expect(identity.gitResolveReason).toBeNull();
  });

  it("keeps a declared stamp but labels it unverified when there is no git metadata", () => {
    const empty = path.join(root, "no-git-here");
    writeFileSync(path.join(empty + ".txt"), "");
    const identity = composeIdentity({ gitDir: path.join(empty, ".git"), declaredCommit: SHA_B, versionFile: path.join(root, "none.json") });
    expect(identity.commit).toBe(SHA_B);
    expect(identity.identitySource).toBe(SOURCE_DECLARED);
    expect(identity.staleStampDetected).toBe(false);
    expect(identity.gitResolveReason).toBeTruthy();
  });

  it("says unknown rather than defaulting to a placeholder commit", () => {
    const identity = composeIdentity({ gitDir: path.join(root, "absent.git"), declaredCommit: "unknown", versionFile: path.join(root, "none.json") });
    expect(identity.commit).toBeNull();
    expect(identity.identitySource).toBe(SOURCE_UNKNOWN);
  });

  it("takes version fields from version.json and survives a malformed one", () => {
    const good = path.join(root, "version.json");
    writeFileSync(good, JSON.stringify({ version: "2.0.0", buildNumber: 1, releaseName: "Radiology Stability" }));
    const git = makeGitDir("ver", { head: "ref: refs/heads/main\n", loose: { ref: "refs/heads/main", sha: SHA_A } });
    expect(composeIdentity({ gitDir: git, versionFile: good })).toMatchObject({
      version: "2.0.0",
      buildNumber: "1",
      releaseName: "Radiology Stability",
    });
    const bad = path.join(root, "bad-version.json");
    writeFileSync(bad, "{not json");
    expect(composeIdentity({ gitDir: git, versionFile: bad }).version).toBeUndefined();
  });
});

describe("command line", () => {
  const run = (args, cwd) => spawnSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: "utf8" });

  it("writes the identity file the image will ship", () => {
    const dir = path.join(root, "cli");
    const git = makeGitDir("cli/.git", { head: SHA_A + "\n" });
    writeFileSync(path.join(dir, "dist.mjs"), "x");
    const r = run(["--git-dir", git, "--artifact", path.join(dir, "dist.mjs"), "--version-file", path.join(root, "none.json"), "--out", path.join(dir, "build-info.json")], dir);
    expect(r.status, r.stderr).toBe(0);
    const written = JSON.parse(readFileSync(path.join(dir, "build-info.json"), "utf8"));
    expect(written.commit).toBe(SHA_A);
    expect(written.identitySource).toBe(SOURCE_GIT);
    expect(written.artifactSha256).toHaveLength(16);
  });

  it("exits 2 under --require-git when git metadata is absent", () => {
    const r = run(["--git-dir", path.join(root, "nothing.git"), "--declared-commit", SHA_A.slice(0, 8), "--require-git"], root);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("did not come from git metadata");
  });

  it("prints the identity when asked, for a CI step to read", () => {
    const git = makeGitDir("print", { head: "ref: refs/heads/main\n", loose: { ref: "refs/heads/main", sha: SHA_A } });
    const r = run(["--git-dir", git, "--version-file", path.join(root, "none.json"), "--print"], root);
    expect(r.status, r.stderr).toBe(0);
    expect(JSON.parse(r.stdout).commit).toBe(SHA_A);
  });
});

describe("the Dockerfile actually uses this resolver", () => {
  const dockerfile = readFileSync(path.join(HERE, "..", "Dockerfile"), "utf8");

  it("builds build-info.json through build-identity.mjs", () => {
    expect(dockerfile).toContain("scripts/build-identity.mjs");
  });

  it("no longer writes build identity straight out of the GIT_COMMIT arg", () => {
    // The printf that made declaredGitCommit the whole answer is how a stale .env
    // became the reported commit. If it comes back, the identity is a guess again.
    expect(dockerfile).not.toContain('declaredGitCommit":"%s');
  });

  it("ships the identity file it computed, rather than recomputing it per stage", () => {
    expect(dockerfile).toMatch(/COPY[^\n]*build-info\.json/);
  });

  it("resolves the identity in the stage that can see the build context", () => {
    // `api` is a slim runtime image: it holds only the deployed bytes, so a resolver
    // running there would find no .git and stamp every image as merely "declared".
    const runAt = dockerfile.indexOf("scripts/build-identity.mjs");
    const buildStage = dockerfile.indexOf("FROM base AS api-build");
    const runtimeStage = dockerfile.indexOf("FROM node:22-bookworm-slim AS api");
    expect(runAt).toBeGreaterThan(buildStage);
    expect(runAt).toBeLessThan(runtimeStage);
  });

  it("hashes the artifact the api image will actually ship", () => {
    const arg = /--artifact\s+(\S+)/.exec(dockerfile);
    expect(arg, "the resolver must be told which bytes to hash").toBeTruthy();
    // The stage copies the built dist DIRECTORY; the hashed file has to live in it,
    // otherwise the hash describes bytes that never leave the build stage.
    const artifact = arg[1].replace(/^\.\//, "");
    const dir = artifact.split("/").slice(0, -1).join("/");
    expect(dockerfile).toContain(`COPY --from=api-build /repo/${dir}`);
    expect(artifact.endsWith("index.mjs")).toBe(true);
  });

  it("declares the ARGs it reads before reading them", () => {
    // An ARG used above its declaration is silently empty, which would turn the
    // declared fallback into "unknown" and hide the very drift this reports.
    const runAt = dockerfile.indexOf("scripts/build-identity.mjs");
    for (const name of ["GIT_COMMIT", "GIT_BRANCH", "GIT_TAG"]) {
      const decl = dockerfile.lastIndexOf(`ARG ${name}=`, runAt);
      expect(decl, `ARG ${name} must be declared before the resolver runs`).toBeGreaterThan(-1);
    }
  });
});

describe("the build context lets the refs through", () => {
  // These four lines are the contract; `scripts/docker-build-identity.mjs` is the
  // proof. It cannot run here (no Docker on this box), so it runs as the
  // `identity` CI job, where a real `docker build` over this `.dockerignore`
  // resolves a real commit and then has it taken away again in arm C. What makes
  // the grep safe is the fallback underneath it: if the refs never arrive the
  // identity degrades to build-arg-declared, and verify-deployed-identity.mjs
  // answers UNKNOWN instead of calling a hand-me-down stamp verified.
  const ignore = readFileSync(path.join(HERE, "..", ".dockerignore"), "utf8").split(/\r?\n/).map((l) => l.trim());
  const lines = ignore.filter((l) => l && !l.startsWith("#"));

  it("excludes the git directory but re-includes exactly what names the commit", () => {
    for (const want of [".git/*", "!.git/HEAD", "!.git/refs", "!.git/refs/**", "!.git/packed-refs"]) {
      expect(lines, `.dockerignore must carry ${want}`).toContain(want);
    }
  });

  it("has no blanket .git exclusion left behind", () => {
    // A bare `.git` line re-appearing here silently un-proves every deployed image.
    expect(lines.filter((l) => l === ".git" || l === "/.git")).toEqual([]);
  });

  it("keeps the rest of the git metadata out of the context", () => {
    // The point of the negations is a small context, not a copy of the repository.
    for (const stay of ["objects", "config", "index", "logs"]) {
      expect(lines.some((l) => l === `!.git/${stay}`)).toBe(false);
    }
  });
});
