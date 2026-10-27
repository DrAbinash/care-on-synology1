import { describe, expect, it } from "vitest";
import {
  buildIdentityPayload,
  buildsMismatch,
  loadImageBuildInfo,
  normalizeBuildCommit,
  parseImageBuildInfo,
  resolveBuildCommit,
} from "./buildIdentity";

const EMPTY_IMAGE = {
  imageBuiltAt: null,
  artifactSha256: null,
  declaredGitCommit: null,
  commit: null,
  identitySource: null,
  gitBranch: null,
  staleStampDetected: false,
  version: null,
  buildNumber: null,
} as const;

describe("normalizeBuildCommit / resolveBuildCommit", () => {
  it("falls back to unknown safely", () => {
    expect(resolveBuildCommit({})).toBe("unknown");
    expect(resolveBuildCommit({ GIT_COMMIT: "unknown" })).toBe("unknown");
    expect(resolveBuildCommit({ GIT_COMMIT: "" })).toBe("unknown");
  });

  it("prefers GIT_COMMIT (canonical) over aliases", () => {
    expect(
      resolveBuildCommit({
        GIT_COMMIT: "aaaaaaaaaaaa",
        CARE_GIT_SHA: "bbbbbbbbbbbb",
      }),
    ).toBe("aaaaaaaaaaaa");
  });

  it("accepts CARE_GIT_SHA when GIT_COMMIT unset", () => {
    expect(resolveBuildCommit({ CARE_GIT_SHA: "cccccccccccc" })).toBe("cccccccccccc");
  });

  it("shortens to 12 chars", () => {
    expect(
      normalizeBuildCommit("0616667905b583dc6e4dca0c6ce7ffeef9d86615"),
    ).toBe("0616667905b5");
  });
});

describe("buildIdentityPayload", () => {
  it("exposes commit plus self-derived fields — no env dump / secrets", () => {
    const payload = buildIdentityPayload(
      {
        GIT_COMMIT: "deadbeefcafe01",
        DATABASE_URL: "postgres://secret",
        QWEN_API_KEY: "sk-secret",
        JWT_SECRET: "nope",
      },
      { ...EMPTY_IMAGE, imageBuiltAt: "2026-10-13T12:00:00Z", artifactSha256: "a1b2c3d4e5f60718", declaredGitCommit: "deadbeefcafe01" },
    );
    expect(payload).toEqual({
      commit: "deadbeefcafe",
      identitySource: "build-arg-declared",
      imageBuiltAt: "2026-10-13T12:00:00Z",
      artifactSha256: "a1b2c3d4e5f60718",
      gitBranch: null,
      declaredGitCommit: "deadbeefcafe01",
      staleStampDetected: false,
      version: null,
      buildNumber: null,
    });
    expect(JSON.stringify(payload)).not.toMatch(/secret|postgres|JWT|QWEN|DATABASE/i);
  });

  it("still reports commit when the image knows nothing about itself", () => {
    // Older images have no build-info.json; /health must not start failing.
    expect(buildIdentityPayload({ GIT_COMMIT: "deadbeefcafe01" }, EMPTY_IMAGE)).toEqual({
      commit: "deadbeefcafe",
      identitySource: "build-arg-declared",
      imageBuiltAt: null,
      artifactSha256: null,
      gitBranch: null,
      declaredGitCommit: null,
      staleStampDetected: false,
      version: null,
      buildNumber: null,
    });
  });

  it("says so when a build-info names a commit but cannot say where it came from", () => {
    // Never upgrade an unexplained claim to the strongest provenance label.
    const payload = buildIdentityPayload({}, { ...EMPTY_IMAGE, commit: "3f04410732b19f4e8ef32343817adfa5a36e5189" });
    expect(payload.commit).toBe("3f04410732b1");
    expect(payload.identitySource).toBe("build-info-without-source");
  });

  it("prefers the commit the build context resolved over the stamp .env declared", () => {
    // The whole point: Container Manager rebuilt newer code with .env still naming
    // 2d51e8d7. Reporting the env stamp was how /health lied for a month.
    const payload = buildIdentityPayload(
      { GIT_COMMIT: "2d51e8d7" },
      {
        ...EMPTY_IMAGE,
        commit: "3f04410732b19f4e8ef32343817adfa5a36e5189",
        identitySource: "build-context-git",
        gitBranch: "main",
        declaredGitCommit: "2d51e8d7",
      },
    );
    expect(payload.commit).toBe("3f04410732b1");
    expect(payload.identitySource).toBe("build-context-git");
    expect(payload.gitBranch).toBe("main");
    expect(payload.declaredGitCommit).toBe("2d51e8d7");
    expect(payload.staleStampDetected).toBe(true);
  });

  it("does not call a stamp stale when it names the same commit", () => {
    const payload = buildIdentityPayload(
      {},
      { ...EMPTY_IMAGE, commit: "3f04410732b19f4e8ef32343817adfa5a36e5189", identitySource: "build-context-git", declaredGitCommit: "3f044107" },
    );
    expect(payload.staleStampDetected).toBe(false);
  });

  it("labels a Dockerfile-precedent image that carries no resolved commit", () => {
    const payload = buildIdentityPayload(
      { GIT_COMMIT: "2d51e8d7" },
      { ...EMPTY_IMAGE, declaredGitCommit: "2d51e8d7", imageBuiltAt: "2026-10-15T02:51:49Z" },
    );
    expect(payload.commit).toBe("2d51e8d7");
    expect(payload.identitySource).toBe("build-arg-declared");
    expect(payload.staleStampDetected).toBe(false);
  });
});

describe("parseImageBuildInfo", () => {
  it("returns nulls for absent or malformed input, never throws", () => {
    expect(parseImageBuildInfo(null)).toEqual(EMPTY_IMAGE);
    expect(parseImageBuildInfo("")).toEqual(EMPTY_IMAGE);
    expect(parseImageBuildInfo("{ not json")).toEqual(EMPTY_IMAGE);
    expect(parseImageBuildInfo("[1,2]")).toEqual(EMPTY_IMAGE);
    expect(parseImageBuildInfo('"a string"')).toEqual(EMPTY_IMAGE);
  });

  it("reads the fields the Dockerfile writes, resolving none of them", () => {
    expect(
      parseImageBuildInfo(
        '{"imageBuiltAt":"2026-10-13T12:00:00Z","artifactSha256":"a1b2c3d4e5f60718","declaredGitCommit":"0616667905b5"}',
      ),
    ).toEqual({
      ...EMPTY_IMAGE,
      imageBuiltAt: "2026-10-13T12:00:00Z",
      artifactSha256: "a1b2c3d4e5f60718",
      declaredGitCommit: "0616667905b5",
    });
  });

  it("reads a resolved identity when the build stage recorded one", () => {
    expect(
      parseImageBuildInfo(
        '{"commit":"3f04410732b19f4e8ef32343817adfa5a36e5189","identitySource":"build-context-git","gitBranch":"main","version":"2.0.0","buildNumber":"1","staleStampDetected":true}',
      ),
    ).toEqual({
      ...EMPTY_IMAGE,
      commit: "3f04410732b19f4e8ef32343817adfa5a36e5189",
      identitySource: "build-context-git",
      gitBranch: "main",
      version: "2.0.0",
      buildNumber: "1",
      staleStampDetected: true,
    });
  });

  it("refuses a commit field that is not a commit", () => {
    // build-info.json is written by a script, but a hand-edited or older file must
    // not become an authoritative identity just because the key exists.
    for (const bogus of ["main", "HEAD", "8 chars", "<&=invalid", "0616"]) {
      expect(parseImageBuildInfo(JSON.stringify({ commit: bogus })).commit).toBeNull();
    }
    expect(parseImageBuildInfo(JSON.stringify({ commit: 42 })).commit).toBeNull();
  });

  it("treats the Dockerfile ARG default as no information", () => {
    // A rebuild with no build-args writes "unknown"; claiming a commit that was
    // never supplied would be exactly the false confidence this file exists to
    // remove.
    expect(
      parseImageBuildInfo(
        '{"imageBuiltAt":"unknown","artifactSha256":"","declaredGitCommit":"unknown"}',
      ),
    ).toEqual(EMPTY_IMAGE);
  });

  it("does not turn a stale stamp into a fresh one, and keeps both visible", () => {
    // The real incident: image built 2026-10-13 while declaring the 2026-09-16
    // commit. Neither value is corrected here — the pair is the evidence.
    const info = parseImageBuildInfo(
      '{"imageBuiltAt":"2026-10-13T09:00:00Z","artifactSha256":"ff00ff00ff00ff00","declaredGitCommit":"2d51e8d7"}',
    );
    expect(info.imageBuiltAt).toBe("2026-10-13T09:00:00Z");
    expect(info.declaredGitCommit).toBe("2d51e8d7");
    expect(normalizeBuildCommit(info.declaredGitCommit)).toBe("2d51e8d7");
  });
});

describe("loadImageBuildInfo", () => {
  it("never throws when no build-info.json exists on the paths given", () => {
    expect(
      loadImageBuildInfo(["/definitely/not/here/build-info.json", "also-not-here.json"]),
    ).toEqual(EMPTY_IMAGE);
  });
});

describe("buildsMismatch", () => {
  it("ignores unknown and flags real skew", () => {
    expect(buildsMismatch("unknown", "deadbeefcafe")).toBe(false);
    expect(buildsMismatch("deadbeefcafe", "deadbeefcafe")).toBe(false);
    expect(buildsMismatch("deadbeefcafe", "cafebabedead")).toBe(true);
  });
});
