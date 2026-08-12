import { describe, expect, it } from "vitest";
import {
  inferDepartmentFromRoomKey,
  normalizeQueueDisplayRoomKey,
  resolveQueueDisplayDepartments,
  shouldSelfHealModalityRoomDepartments,
} from "./queueDisplayDepartments";

describe("queueDisplayDepartments", () => {
  it("normalizes room keys with optional -room suffix", () => {
    expect(normalizeQueueDisplayRoomKey("usg-room")).toBe("usg");
    expect(normalizeQueueDisplayRoomKey("MRI")).toBe("mri");
  });

  it("infers token departments from common room keys", () => {
    expect(inferDepartmentFromRoomKey("usg")).toBe("USG");
    expect(inferDepartmentFromRoomKey("usg-room")).toBe("USG");
    expect(inferDepartmentFromRoomKey("mri")).toBe("MRI");
    expect(inferDepartmentFromRoomKey("ct")).toBe("CT");
    expect(inferDepartmentFromRoomKey("xray")).toBe("X-Ray");
    expect(inferDepartmentFromRoomKey("x-ray")).toBe("X-Ray");
    expect(inferDepartmentFromRoomKey("cardiology")).toBe("Cardiology");
    expect(inferDepartmentFromRoomKey("echo")).toBe("USG");
  });

  it("returns null for reception or unknown rooms", () => {
    expect(inferDepartmentFromRoomKey("reception")).toBeNull();
    expect(inferDepartmentFromRoomKey("lobby")).toBeNull();
  });

  it("/queue/usg with blank departments → USG only", () => {
    expect(resolveQueueDisplayDepartments("usg", "")).toEqual(["USG"]);
    expect(resolveQueueDisplayDepartments("usg", "   ")).toEqual(["USG"]);
    expect(resolveQueueDisplayDepartments("usg", null)).toEqual(["USG"]);
  });

  it("legacy USG room with accidental MRI/CT config self-heals to USG only", () => {
    expect(shouldSelfHealModalityRoomDepartments("usg", "MRI,CT")).toEqual({
      heal: true,
      target: "USG",
      reason: "legacy_foreign_only",
    });
    expect(resolveQueueDisplayDepartments("usg", "MRI,CT")).toEqual(["USG"]);
    expect(resolveQueueDisplayDepartments("usg", "MRI")).toEqual(["USG"]);
    expect(resolveQueueDisplayDepartments("usg-room", "CT,X-Ray")).toEqual(["USG"]);
  });

  it("intentionally configured multi-department room remains allowed", () => {
    expect(shouldSelfHealModalityRoomDepartments("usg", "USG,MRI")).toEqual({
      heal: false,
      target: null,
      reason: null,
    });
    expect(resolveQueueDisplayDepartments("usg", "USG,MRI")).toEqual(["USG", "MRI"]);
    expect(resolveQueueDisplayDepartments("usg", "USG,MRI,CT")).toEqual(["USG", "MRI", "CT"]);
    // Reception / generic multi-dept displays are never force-healed
    expect(resolveQueueDisplayDepartments("reception", "MRI,CT")).toEqual(["MRI", "CT"]);
    expect(resolveQueueDisplayDepartments("reception", "")).toEqual([]);
    expect(resolveQueueDisplayDepartments("lobby", "Pathology,USG")).toEqual(["Pathology", "USG"]);
  });

  it("MRI tokens never leak into canonical USG queue by default", () => {
    const depts = resolveQueueDisplayDepartments("usg", "");
    expect(depts).toEqual(["USG"]);
    expect(depts).not.toContain("MRI");
    expect(depts).not.toContain("CT");

    // Even with legacy stale config, effective filter excludes MRI
    const healed = resolveQueueDisplayDepartments("usg", "MRI,CT");
    expect(healed).toEqual(["USG"]);
    expect(healed.includes("MRI")).toBe(false);
  });

  it("USG tokens still match the canonical USG filter (Call Next dept intact)", () => {
    // Display filter for /queue/usg must include USG so USG tokens render.
    // Call Next (/api/test-tokens/:id/call) keys off the token's own department
    // — unchanged by display settings — so USG tokens remain callable.
    const depts = resolveQueueDisplayDepartments("usg", "");
    expect(depts).toContain("USG");
    const tokenDepartment = "USG";
    expect(depts.includes(tokenDepartment)).toBe(true);
    const mriTokenDepartment = "MRI";
    expect(depts.includes(mriTokenDepartment)).toBe(false);
  });

  it("keeps all departments only for unknown multi-dept rooms like reception", () => {
    expect(resolveQueueDisplayDepartments("reception", "")).toEqual([]);
  });

  it("MRI room blank → MRI only (symmetric modality invariant)", () => {
    expect(resolveQueueDisplayDepartments("mri", "")).toEqual(["MRI"]);
    expect(resolveQueueDisplayDepartments("mri", "USG,CT")).toEqual(["MRI"]); // legacy foreign-only
    expect(resolveQueueDisplayDepartments("mri", "MRI,USG")).toEqual(["MRI", "USG"]); // intentional
  });
});
