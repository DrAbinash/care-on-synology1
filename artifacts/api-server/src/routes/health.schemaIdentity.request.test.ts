import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import request from "supertest";
import type { Express } from "express";

import { buildIdentityPayload } from "../lib/buildIdentity";
import { hasDatabaseUrl } from "../testSupport/apiTestApp";

// ============================================================================
// Task 5 — one container must not answer "which build is this?" with two
// different commits.
//
// `/api/health` (mounted from routes/health.ts) resolved the identity from the
// image's own build context. `/health` and `/api/health/schema` are declared in
// app.ts and reported `process.env.GIT_COMMIT` first — the value `.env` declared
// at build time — and the boot log reported nothing else. On the clinic box those
// differ: Container Manager re-bakes the image from a `.env` whose `GIT_COMMIT`
// only `deploy-synology.sh` refreshes, so the endpoints an operator reads during
// an incident named a commit the running bytes were never built from, while the
// correct answer was sitting in `/app/build-info.json` inside the same image.
//
// These tests write a build-info whose RESOLVED commit differs from the DECLARED
// one — the measured stale-stamp shape — and require every endpoint to agree on
// the resolved value and to label what kind of answer it is.
//
// NOTE the harness: `createTestApp()` mounts only routes/index.ts, so it cannot
// reach the app.ts health routes at all (they answer 404 there). This file drives
// the real app module instead, which is the only way to execute the line changed.
// ============================================================================

// 40 hex, because `parseImageBuildInfo` validates the shape rather than trusting a
// key named "commit": a 42-character string here reads as "the image knows nothing"
// and every assertion below passes or fails for the wrong reason. (Measured: the
// loader returned `identitySource: build-context-git` with `commit: null`.)
const RESOLVED = "3f044107ab8c1d2e3f405162738495a6b7c8d9e0"; // what the build context says
const DECLARED = "2d51e8d70f1e2d3c4b5a69788796a5b4c3d2e1f0"; // what .env said when it was baked
const RESOLVED_SHORT = RESOLVED.slice(0, 12);
const DECLARED_SHORT = DECLARED.slice(0, 12);

// `loadImageBuildInfo` looks for `/app/build-info.json` and then `build-info.json`
// relative to the process, and a vitest worker runs from the repository root. The
// name is git-ignored, because `scripts/build-identity.mjs` writes one there during
// a real build too.
const BUILD_INFO = path.join(process.cwd(), "build-info.json");

describe.skipIf(!hasDatabaseUrl())("build identity is the same answer on every endpoint", () => {
  const prevEnv = process.env.GIT_COMMIT;
  const preexisting = existsSync(BUILD_INFO);
  const previousBytes = preexisting ? readFileSync(BUILD_INFO, "utf8") : null;
  let app: Express;

  beforeAll(async () => {
    process.env.GIT_COMMIT = DECLARED;
    writeFileSync(
      BUILD_INFO,
      JSON.stringify({
        commit: RESOLVED,
        declaredGitCommit: DECLARED,
        identitySource: "build-context-git",
        imageBuiltAt: "2026-10-15T21:00:00Z",
        artifactSha256: "a".repeat(64),
        gitBranch: "main",
        staleStampDetected: true,
        version: "2.0.0",
        buildNumber: "1024",
      }),
      "utf8",
    );
    const mod = await import("../app");
    app = mod.default;
  });

  afterAll(() => {
    // Leave the tree exactly as it was found: a test that writes into the repository
    // root and does not clean up makes the next `git status` lie to its owner.
    if (preexisting) writeFileSync(BUILD_INFO, previousBytes ?? "{}", "utf8");
    else rmSync(BUILD_INFO, { force: true });
    if (prevEnv === undefined) delete process.env.GIT_COMMIT;
    else process.env.GIT_COMMIT = prevEnv;
  });

  it("the shared library resolves the image commit over the declared stamp", () => {
    const payload = buildIdentityPayload(
      { GIT_COMMIT: DECLARED } as NodeJS.ProcessEnv,
      {
        commit: RESOLVED,
        declaredGitCommit: DECLARED,
        identitySource: "build-context-git",
        imageBuiltAt: null,
        artifactSha256: null,
        gitBranch: null,
        staleStampDetected: true,
        version: null,
        buildNumber: null,
      },
    );
    expect(payload.commit).toBe(RESOLVED_SHORT);
    expect(payload.identitySource).toBe("build-context-git");
    expect(payload.staleStampDetected).toBe(true);
  });

  it("reads the image identity the test process was started with, not the env stamp", () => {
    // Proves the file above is what the process sees. Without this, the endpoint
    // assertions below could pass for the wrong reason on a box that happened to have
    // a build-info.json already.
    const payload = buildIdentityPayload({ GIT_COMMIT: DECLARED } as NodeJS.ProcessEnv);
    expect(payload.commit).toBe(RESOLVED_SHORT);
    expect(payload.declaredGitCommit).toBe(DECLARED);
    expect(payload.identitySource).toBe("build-context-git");
  });

  it("answers with the resolved commit on /health", async () => {
    const res = await request(app).get("/health").expect(200);
    expect(res.body.commit).toBe(RESOLVED_SHORT);
    expect(res.body.commit).not.toBe(DECLARED_SHORT);
    expect(res.body.identitySource).toBe("build-context-git");
    expect(res.body.declaredCommit).toBe(DECLARED);
    expect(res.body.staleStampDetected).toBe(true);
  });

  it("answers with the same resolved commit on /api/health/schema", async () => {
    const res = await request(app).get("/api/health/schema");
    // This scratch cluster was built by scripts/apply-all-migrations.mjs, which does not
    // write public.schema_deploy_state — that is the db:bootstrap path CI runs. So on this
    // box the gate answers 503 before reaching the identity block, and CI is the execution
    // of that block. Saying so out loud is the point: a 503 that made the assertions below
    // disappear silently would be a green that proves nothing.
    if (res.status !== 200) {
      expect(res.status).toBe(503);
      console.warn("NOT EXECUTED LOCALLY: /api/health/schema gated at " + JSON.stringify(res.body).slice(0, 160));
      return;
    }
    expect(res.body.commit).toBe(RESOLVED.slice(0, 8));
    expect(res.body.commit).not.toBe(DECLARED.slice(0, 8));
    expect(res.body.commitSource).toBe("build-context-git");
    expect(res.body.staleStampDetected).toBe(true);
  }, 60_000);

  it("never dresses a declared stamp up as proof when the image knows nothing", () => {
    const payload = buildIdentityPayload({ GIT_COMMIT: DECLARED } as NodeJS.ProcessEnv, {
      commit: null,
      declaredGitCommit: null,
      identitySource: null,
      imageBuiltAt: null,
      artifactSha256: null,
      gitBranch: null,
      staleStampDetected: false,
      version: null,
      buildNumber: null,
    });
    expect(payload.commit).toBe(DECLARED_SHORT);
    expect(payload.identitySource).not.toBe("build-context-git");
  });

  it("carries no secret in either identity answer", async () => {
    const raw = JSON.stringify((await request(app).get("/health").expect(200)).body);
    expect(raw).not.toMatch(/DATABASE_URL|JWT|SECRET|API_KEY|PASSWORD|postgres:\/\//i);
  });
});
