import { describe, expect, it } from "vitest";
import {
  buildIdentityPayload,
  buildsMismatch,
  normalizeBuildCommit,
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
  it("exposes only commit — no env dump / secrets", () => {
    const payload = buildIdentityPayload({
      GIT_COMMIT: "deadbeefcafe01",
      DATABASE_URL: "postgres://secret",
      QWEN_API_KEY: "sk-secret",
      JWT_SECRET: "nope",
    });
    expect(payload).toEqual({ commit: "deadbeefcafe" });
    expect(JSON.stringify(payload)).not.toMatch(/secret|postgres|JWT|QWEN|DATABASE/i);
  });
});

describe("buildsMismatch", () => {
  it("ignores unknown and flags real skew", () => {
    expect(buildsMismatch("unknown", "deadbeefcafe")).toBe(false);
    expect(buildsMismatch("deadbeefcafe", "deadbeefcafe")).toBe(false);
    expect(buildsMismatch("deadbeefcafe", "cafebabedead")).toBe(true);
  });
});
