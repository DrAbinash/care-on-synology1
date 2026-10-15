import { describe, expect, it } from "vitest";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

import {
  FAIL,
  PASS,
  UNKNOWN,
  crossCheck,
  sameCommit,
  verdictFor,
} from "./verify-deployed-identity.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(HERE, "verify-deployed-identity.mjs");

const SHA = "3f04410732b19f4e8ef32343817adfa5a36e5189";
const RESOLVED = { commit: SHA, identitySource: "build-context-git" };

describe("sameCommit", () => {
  it("tolerates the short form a stamp carries", () => {
    expect(sameCommit("3f044107", SHA)).toBe(true);
    expect(sameCommit(SHA.toUpperCase(), "3F044107")).toBe(true);
  });

  it("will not call two different commits the same", () => {
    expect(sameCommit("2d51e8d7", SHA)).toBe(false);
    expect(sameCommit("unknown", SHA)).toBe(false);
    expect(sameCommit(undefined, SHA)).toBe(false);
    expect(sameCommit("3f0441", SHA)).toBe(false); // 6 chars is a coincidence, not a match
  });
});

describe("verdictFor", () => {
  it("passes only when the resolved running commit is the deployed one", () => {
    const v = verdictFor({ expected: "3f044107", running: { ...RESOLVED, staleStampDetected: true } });
    expect(v.status).toBe(PASS);
    expect(v.detail).toContain("correctly ignored");
  });

  it("FAILs when the running build is a different commit — the headline rule", () => {
    const v = verdictFor({ expected: SHA, running: { commit: "2d51e8d7aaaa3f04410732b19f4e8ef3234381", identitySource: "build-context-git", imageBuiltAt: "2026-09-16T00:00:00Z" } });
    expect(v.status).toBe(FAIL);
    expect(v.detail).toContain("expected");
    expect(v.remediation).toContain("care-erp-github");
  });

  it("UNKNOWN when the app cannot say what it is running — never a silent pass", () => {
    for (const commit of [undefined, "", "unknown", "HEAD"]) {
      const v = verdictFor({ expected: SHA, running: { commit, identitySource: "build-context-git" } });
      expect(v.status, `commit=${JSON.stringify(commit)}`).toBe(UNKNOWN);
    }
  });

  it("UNKNOWN when the commit is declared rather than resolved", () => {
    // A stale .env stamp can name any commit confidently; confidence is not proof.
    const v = verdictFor({ expected: SHA, running: { commit: SHA, identitySource: "build-arg-declared" } });
    expect(v.status).toBe(UNKNOWN);
    expect(v.remediation).toContain(".dockerignore");
  });

  it("UNKNOWN when nobody said what was supposed to be running", () => {
    const v = verdictFor({ expected: null, running: { ...RESOLVED } });
    expect(v.status).toBe(UNKNOWN);
    expect(v.detail).toContain("no expected commit");
  });

  it("UNKNOWN when the deployment said nothing at all", () => {
    expect(verdictFor({ expected: SHA, running: null }).status).toBe(UNKNOWN);
  });
});

describe("crossCheck", () => {
  it("is silent when both health surfaces agree", () => {
    expect(crossCheck({ commit: SHA }, { build: { commit: "3f044107" } })).toBeNull();
  });

  it("reports when they disagree — one of them is lying about this image", () => {
    expect(crossCheck({ commit: SHA }, { build: { commit: "2d51e8d7" } })).toContain("2d51e8d7");
  });

  it("stays quiet when the second surface has nothing to say", () => {
    expect(crossCheck({ commit: SHA }, {})).toBeNull();
    expect(crossCheck({ commit: SHA }, null)).toBeNull();
  });
});

describe("command line against a real server", () => {
  const listen = (handler) =>
    new Promise((resolve) => {
      const server = createServer(handler);
      server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port }));
    });

  // Not spawnSync: the stub server runs on this event loop, and a blocking spawn
  // would stop it from ever answering — the test would measure its own deadlock.
  const run = (args) =>
    new Promise((resolve) => {
      execFile(process.execPath, [SCRIPT, ...args], { encoding: "utf8" }, (err, stdout, stderr) => {
        resolve({ status: err ? err.code ?? 1 : 0, stdout, stderr });
      });
    });

  it("exits 0 when the deployed commit matches what it resolves", async () => {
    const { server, port } = await listen((req, res) => {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(req.url.startsWith("/api/") ? { status: "ok", build: { commit: SHA } } : { ok: true, commit: SHA, identitySource: "build-context-git", imageBuiltAt: "2026-10-15T02:51:49Z" }));
    });
    try {
      const r = await run(["--expected", "3f044107", "--base-url", `http://127.0.0.1:${port}`, "--json"]);
      expect(r.stdout, r.stderr).toContain('"PASS"');
      expect(r.status).toBe(0);
    } finally {
      server.close();
    }
  });

  it("exits 1 when the container is running other code", async () => {
    const { server, port } = await listen((_req, res) => {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ ok: true, commit: "2d51e8d7aaaa3f04410732b19f4e8ef3234381", identitySource: "build-context-git" }));
    });
    try {
      const r = await run(["--expected", SHA, "--base-url", `http://127.0.0.1:${port}`]);
      expect(r.stdout).toContain("FAIL");
      expect(r.status).toBe(1);
    } finally {
      server.close();
    }
  });

  it("exits 2 when nothing is listening — an unreachable deploy is not a verified one", async () => {
    const r = await run(["--expected", SHA, "--base-url", "http://127.0.0.1:1", "--timeout", "2000"]);
    expect(r.stdout).toContain("UNKNOWN");
    expect(r.status).toBe(2);
  });

  it("exits 2 when the reported identity is not a commit", async () => {
    const { server, port } = await listen((_req, res) => {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ ok: true, commit: "HEAD", identitySource: "build-context-git" }));
    });
    try {
      const r = await run(["--expected", SHA, "--base-url", `http://127.0.0.1:${port}`]);
      expect(r.stdout).toContain("not a commit");
      expect(r.status).toBe(2);
    } finally {
      server.close();
    }
  });

  it("exits 2 when the two health surfaces disagree about the same container", async () => {
    const { server, port } = await listen((req, res) => {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(req.url.startsWith("/api/") ? { build: { commit: "2d51e8d7" } } : { commit: SHA, identitySource: "build-context-git" }));
    });
    try {
      const r = await run(["--expected", "3f044107", "--base-url", `http://127.0.0.1:${port}`]);
      expect(r.stdout).toContain("UNKNOWN");
      expect(r.status).toBe(2);
    } finally {
      server.close();
    }
  });
});
