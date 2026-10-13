import { describe, expect, it } from "vitest";
import {
  buildIdentityPayload,
  buildsMismatch,
  loadImageBuildInfo,
  normalizeBuildCommit,
  parseImageBuildInfo,
  resolveBuildCommit,
} from "./buildIdentity";

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
      { imageBuiltAt: "2026-10-13T12:00:00Z", artifactSha256: "a1b2c3d4e5f60718", declaredGitCommit: "deadbeefcafe01" },
    );
    expect(payload).toEqual({
      commit: "deadbeefcafe",
      imageBuiltAt: "2026-10-13T12:00:00Z",
      artifactSha256: "a1b2c3d4e5f60718",
    });
    expect(JSON.stringify(payload)).not.toMatch(/secret|postgres|JWT|QWEN|DATABASE/i);
  });

  it("still reports commit when the image knows nothing about itself", () => {
    // Older images have no build-info.json; /health must not start failing.
    expect(
      buildIdentityPayload({ GIT_COMMIT: "deadbeefcafe01" }, {
        imageBuiltAt: null,
        artifactSha256: null,
        declaredGitCommit: null,
      }),
    ).toEqual({ commit: "deadbeefcafe", imageBuiltAt: null, artifactSha256: null });
  });
});

describe("parseImageBuildInfo", () => {
  it("returns nulls for absent or malformed input, never throws", () => {
    const empty = { imageBuiltAt: null, artifactSha256: null, declaredGitCommit: null };
    expect(parseImageBuildInfo(null)).toEqual(empty);
    expect(parseImageBuildInfo("")).toEqual(empty);
    expect(parseImageBuildInfo("{ not json")).toEqual(empty);
    expect(parseImageBuildInfo("[1,2]")).toEqual(empty);
    expect(parseImageBuildInfo('"a string"')).toEqual(empty);
  });

  it("reads the three fields the Dockerfile writes", () => {
    expect(
      parseImageBuildInfo(
        '{"imageBuiltAt":"2026-10-13T12:00:00Z","artifactSha256":"a1b2c3d4e5f60718","declaredGitCommit":"0616667905b5"}',
      ),
    ).toEqual({
      imageBuiltAt: "2026-10-13T12:00:00Z",
      artifactSha256: "a1b2c3d4e5f60718",
      declaredGitCommit: "0616667905b5",
    });
  });

  it("treats the Dockerfile ARG default as no information", () => {
    // A rebuild with no build-args writes "unknown"; claiming a commit that was
    // never supplied would be exactly the false confidence this file exists to
    // remove.
    expect(
      parseImageBuildInfo(
        '{"imageBuiltAt":"unknown","artifactSha256":"","declaredGitCommit":"unknown"}',
      ),
    ).toEqual({ imageBuiltAt: null, artifactSha256: null, declaredGitCommit: null });
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
    ).toEqual({ imageBuiltAt: null, artifactSha256: null, declaredGitCommit: null });
  });
});

describe("buildsMismatch", () => {
  it("ignores unknown and flags real skew", () => {
    expect(buildsMismatch("unknown", "deadbeefcafe")).toBe(false);
    expect(buildsMismatch("deadbeefcafe", "deadbeefcafe")).toBe(false);
    expect(buildsMismatch("deadbeefcafe", "cafebabedead")).toBe(true);
  });
});
