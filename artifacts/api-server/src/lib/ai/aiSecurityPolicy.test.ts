/**
 * STAGE 1 PR-A2 — the AI security mode's decision module.
 *
 * The rule under test is a fail-closed one: the mode is the only knob, its two
 * dependent flags are derived and never stored, and anything the server cannot
 * recognise resolves to Clinical. A permissive default here would be the exact
 * defect PR-A was opened to close, so most of these cases are about the ways a
 * value can go wrong (missing row, unparseable JSON, a typo, an unexpected type,
 * a database that will not answer) and what the send then does.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  settingsJson: null as string | null,
  throws: false,
  ops: {
    deepseekCloudVisionAllowed: false,
    nightVisionProvider: "local",
  },
  opsThrows: false,
}));

vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => {
            if (h.throws) throw new Error("database unavailable");
            return [{ settingsJson: h.settingsJson }];
          },
        }),
      }),
    }),
  },
}));
vi.mock("@workspace/db/schema", () => ({
  aiProviderSettingsTable: { provider: "provider", settingsJson: "settings_json" },
}));
vi.mock("drizzle-orm", () => ({ eq: () => "where" }));
vi.mock("./clinicalConfigService", () => ({
  getOvernightOpsControls: async () => {
    if (h.opsThrows) throw new Error("config service down");
    return h.ops;
  },
}));

import {
  FALLBACK_AI_SECURITY_MODE,
  flagsForMode,
  parseAiSecurityMode,
  readAiSecurityModeFromJson,
  resolveAiSecurityPolicy,
  sanitizeGlobalSettingsPatch,
} from "./aiSecurityPolicy";

beforeEach(() => {
  h.settingsJson = null;
  h.throws = false;
  h.opsThrows = false;
  h.ops = { deepseekCloudVisionAllowed: false, nightVisionProvider: "local" };
});

describe("mode parsing is fail-closed", () => {
  it("takes the two modes it knows", () => {
    expect(parseAiSecurityMode("clinical")).toBe("clinical");
    expect(parseAiSecurityMode("development")).toBe("development");
  });

  it("trims and case-folds the value an admin actually typed", () => {
    expect(parseAiSecurityMode("  Development ")).toBe("development");
  });

  it("resolves anything else to the STRICTEST mode, not the permissive one", () => {
    // "developmen" is the dangerous case: one character from working, and it is
    // closer to a real word than to garbage.
    for (const bad of ["developmen", "dev", "DEVELOPMENTAL", "", "  ", "testing", "prod"]) {
      expect(parseAiSecurityMode(bad)).toBe(FALLBACK_AI_SECURITY_MODE);
    }
  });

  it("refuses to guess from null, undefined, numbers or objects", () => {
    for (const bad of [null, undefined, 0, 1, true, false, {}, []]) {
      expect(parseAiSecurityMode(bad)).toBe("clinical");
    }
  });

  it("the fallback is Clinical, asserted rather than implied by the constant", () => {
    expect(FALLBACK_AI_SECURITY_MODE).toBe("clinical");
  });
});

describe("dependent flags are derived, never stored", () => {
  it("Development drops the attestation and the strict audit", () => {
    expect(flagsForMode("development")).toEqual({
      requireAttestation: false,
      strictAudit: false,
    });
  });

  it("Clinical requires both", () => {
    expect(flagsForMode("clinical")).toEqual({ requireAttestation: true, strictAudit: true });
  });

  it("no input produces attestation-off AND strict-audit-off outside Development", () => {
    // Ruling 2: the switches must not be independently settable, so the only way to
    // reach a loosened pair is to be in the loosened mode.
    const pairs = new Set(
      (["development", "clinical"] as const).map((m) => JSON.stringify(flagsForMode(m))),
    );
    expect(pairs.has(JSON.stringify({ requireAttestation: false, strictAudit: true }))).toBe(false);
    expect(pairs.size).toBe(2);
  });
});

describe("resolveAiSecurityPolicy reads what the clinic already configured", () => {
  it("missing row means Clinical", async () => {
    const p = await resolveAiSecurityPolicy();
    expect(p.mode).toBe("clinical");
    expect(p.requireAttestation).toBe(true);
    expect(p.strictAudit).toBe(true);
  });

  it("unparseable JSON means Clinical", async () => {
    h.settingsJson = "{ not json";
    expect((await resolveAiSecurityPolicy()).mode).toBe("clinical");
  });

  it("a row without the mode key means Clinical", async () => {
    h.settingsJson = JSON.stringify({ enabled: true, cloudTextPhiAllowed: true });
    const p = await resolveAiSecurityPolicy();
    expect(p.mode).toBe("clinical");
    expect(p.requireAttestation).toBe(true);
  });

  it("a typo in the stored mode means Clinical, not permissive", async () => {
    h.settingsJson = JSON.stringify({ aiSecurityMode: "developerr" });
    expect((await resolveAiSecurityPolicy()).mode).toBe("clinical");
  });

  it("an explicit development row is honoured, and the flags follow", async () => {
    h.settingsJson = JSON.stringify({ aiSecurityMode: "development" });
    expect(await resolveAiSecurityPolicy()).toEqual({
      mode: "development",
      cloudVisionAllowed: false,
      requireAttestation: false,
      strictAudit: false,
    });
  });

  it("carries the clinic's EXISTING cloud-vision opt-in, not a new one", async () => {
    h.settingsJson = JSON.stringify({ aiSecurityMode: "development" });
    h.ops = { deepseekCloudVisionAllowed: true, nightVisionProvider: "deepseek" };
    expect((await resolveAiSecurityPolicy()).cloudVisionAllowed).toBe(true);
  });

  it("accepts the legacy alias the overnight flag has always accepted", async () => {
    // `gatewayInferenceProvider` has read both keys for as long as they have existed;
    // a policy resolver that read only one would change the meaning of a saved setting.
    h.ops = {
      deepseekCloudVisionAllowed: false,
      cloudVisionAllowed: true,
      nightVisionProvider: "deepseek",
    } as typeof h.ops;
    expect((await resolveAiSecurityPolicy()).cloudVisionAllowed).toBe(true);
  });

  it("Development WITHOUT the opt-in still reports cloud vision off", async () => {
    h.settingsJson = JSON.stringify({ aiSecurityMode: "development" });
    const p = await resolveAiSecurityPolicy();
    expect(p.mode).toBe("development");
    expect(p.cloudVisionAllowed).toBe(false);
  });

  it("a settings read that fails cannot open the door even in Development", async () => {
    h.settingsJson = JSON.stringify({ aiSecurityMode: "development" });
    h.throws = true;
    h.ops = { deepseekCloudVisionAllowed: true, nightVisionProvider: "deepseek" };
    const p = await resolveAiSecurityPolicy();
    expect(p).toEqual({
      mode: "clinical",
      cloudVisionAllowed: false,
      requireAttestation: true,
      strictAudit: true,
    });
  });

  it("an overnight-controls failure is not an invitation: cloud vision off", async () => {
    h.settingsJson = JSON.stringify({ aiSecurityMode: "development" });
    h.opsThrows = true;
    const p = await resolveAiSecurityPolicy();
    expect(p.cloudVisionAllowed).toBe(false);
    // The mode itself is still known from its own row, so a config-service outage
    // costs the opt-in and nothing else — and without the opt-in no image can leave.
    expect(p.mode).toBe("development");
    expect(p.requireAttestation).toBe(false);
  });

  it("reads the row every call, so a saved change takes effect without a restart", async () => {
    h.settingsJson = JSON.stringify({ aiSecurityMode: "clinical" });
    expect((await resolveAiSecurityPolicy()).mode).toBe("clinical");
    h.settingsJson = JSON.stringify({ aiSecurityMode: "development" });
    expect((await resolveAiSecurityPolicy()).mode).toBe("development");
  });
});

describe("readAiSecurityModeFromJson is the same rule for the route and the audit diff", () => {
  it("null / empty / broken all read as Clinical", () => {
    expect(readAiSecurityModeFromJson(null)).toBe("clinical");
    expect(readAiSecurityModeFromJson("")).toBe("clinical");
    expect(readAiSecurityModeFromJson("[1,2,3]")).toBe("clinical");
  });

  it("reads a stored mode", () => {
    expect(readAiSecurityModeFromJson(JSON.stringify({ aiSecurityMode: "development" }))).toBe(
      "development",
    );
  });
});

describe("the global-settings allowlist (no unchecked spread into a security blob)", () => {
  it("rejects an invented key by name instead of storing it", () => {
    const r = sanitizeGlobalSettingsPatch({ enabled: true, aiSecurityMdoe: "development" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("aiSecurityMdoe");
  });

  it("will not persist a security mode that is not one of the two", () => {
    for (const bad of ["develop", "DEVELOPMENT2", "", "clinical ", 7, true]) {
      const r = sanitizeGlobalSettingsPatch({ aiSecurityMode: bad as unknown as string });
      // "clinical " is legal after trimming; the rest are refused.
      if (bad !== "clinical ") {
        expect(r.ok).toBe(false);
      }
    }
    const trimmed = sanitizeGlobalSettingsPatch({ aiSecurityMode: " Clinical " });
    expect(trimmed.ok).toBe(true);
    if (trimmed.ok) expect(trimmed.patch.aiSecurityMode).toBe("clinical");
  });

  it("type-checks the existing keys rather than trusting the client", () => {
    expect(sanitizeGlobalSettingsPatch({ enabled: "yes" }).ok).toBe(false);
    expect(sanitizeGlobalSettingsPatch({ allowedRoles: "admin" }).ok).toBe(false);
    expect(sanitizeGlobalSettingsPatch({ defaultPrompt: 42 }).ok).toBe(false);
    const ok = sanitizeGlobalSettingsPatch({
      enabled: true,
      allowedRoles: ["doctor"],
      defaultPrompt: "x",
    });
    expect(ok.ok).toBe(true);
  });

  it("leaves every key the caller did not send out of the patch, so the merge cannot wipe one", () => {
    const r = sanitizeGlobalSettingsPatch({ aiSecurityMode: "development" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(Object.keys(r.patch)).toEqual(["aiSecurityMode"]);
      expect(r.modeChanged).toBe(true);
    }
  });

  it("modeChanged is false for an ordinary settings save, so the audit trail stays clean", () => {
    const r = sanitizeGlobalSettingsPatch({ anonymize: false });
    expect(r.ok && r.modeChanged).toBe(false);
  });

  it("refuses a non-object body instead of spreading a string into the row", () => {
    expect(sanitizeGlobalSettingsPatch("development").ok).toBe(false);
    expect(sanitizeGlobalSettingsPatch(null).ok).toBe(false);
    expect(sanitizeGlobalSettingsPatch(["a"]).ok).toBe(false);
  });
});
