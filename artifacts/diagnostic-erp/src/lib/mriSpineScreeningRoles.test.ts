import { describe, expect, it } from "vitest";

import {
  SCREENING_ROLE_DICTIONARY,
  dedicatedPrimaryRegion,
  offeredScreeningRegions,
  resolveScreeningRoles,
  screeningRolesSummary,
} from "./mriSpineScreeningRoles";

const rolesOf = (input: Parameters<typeof resolveScreeningRoles>[0]) => resolveScreeningRoles(input).roles;

describe("spine screening role resolver (spec §23)", () => {
  it("maps every documented catalog code to its role set", () => {
    expect(rolesOf({ code: "MRI016" })).toEqual({
      cervical: "primary-screening",
      dorsal: "absent",
      ls: "absent",
    });
    expect(rolesOf({ code: "MRI021" })).toEqual({
      cervical: "absent",
      dorsal: "primary-screening",
      ls: "absent",
    });
    expect(rolesOf({ code: "MRI037" })).toEqual({
      cervical: "absent",
      dorsal: "absent",
      ls: "primary-screening",
    });
    expect(rolesOf({ code: "MRI062" })).toEqual({
      cervical: "primary-screening",
      dorsal: "primary-screening",
      ls: "primary-screening",
    });
    expect(rolesOf({ code: "MRICEWSS" })).toEqual({
      cervical: "primary-dedicated",
      dorsal: "accompanying-screening",
      ls: "accompanying-screening",
    });
    expect(rolesOf({ code: "MRI038" })).toEqual({
      cervical: "accompanying-screening",
      dorsal: "accompanying-screening",
      ls: "primary-dedicated",
    });
  });

  it("matches billed names as well as codes", () => {
    expect(rolesOf({ name: "MRI LS SPINE WITH SCREENING WHOLE SPINE" })).toEqual(rolesOf({ code: "MRI038" }));
    expect(rolesOf({ name: "MRI CERVICAL SPINE WITH WHOLE SPINE SCREENING" })).toEqual(rolesOf({ code: "MRICEWSS" }));
    expect(rolesOf({ name: "MRI DORSAL SPINE SCREENING" })).toEqual(rolesOf({ code: "MRI021" }));
    expect(resolveScreeningRoles({ name: "MRI WHOLE SPINE SCREENING" }).matchedKey).toBe("MRI062");
    expect(resolveScreeningRoles({ code: "mri-038" }).matchedKey).toBe("MRI038");
    expect(SCREENING_ROLE_DICTIONARY.length).toBeGreaterThanOrEqual(7);
  });

  it("a plain dedicated study gets no screening modules", () => {
    const roles = rolesOf({ name: "MRI LUMBOSACRAL SPINE" });
    expect(roles).toEqual({ cervical: "absent", dorsal: "absent", ls: "primary-dedicated" });
    expect(offeredScreeningRegions(roles)).toEqual([]);
    expect(dedicatedPrimaryRegion(roles)).toBe("ls");
  });

  it("never offers a region as its own screening module", () => {
    const roles = rolesOf({ code: "MRI038" });
    expect(roles.ls).toBe("primary-dedicated");
    expect(offeredScreeningRegions(roles)).toEqual(["cervical", "dorsal"]);
    expect(offeredScreeningRegions(roles)).not.toContain("ls");
  });

  it("treats an unlabeled whole-spine screening description as three screening regions", () => {
    const roles = rolesOf({ studyDescription: "limited whole spine screening of the cervical and dorsal spine" });
    expect(roles.cervical).toBe("primary-screening");
    expect(roles.dorsal).toBe("primary-screening");
    expect(roles.ls).toBe("primary-screening");
  });

  it("keeps a dedicated primary when whole-spine screening accompanies it", () => {
    const resolved = resolveScreeningRoles({ studyDescription: "MRI DORSAL SPINE WITH WHOLE SPINE SCREENING" });
    expect(resolved.roles.dorsal).toBe("primary-dedicated");
    expect(resolved.roles.cervical).toBe("accompanying-screening");
    expect(resolved.roles.ls).toBe("accompanying-screening");
    expect(resolved.matchedKey).toBe("DEDICATED_DORSAL_PLUS_SCREENING");
  });

  it("returns all-absent when nothing identifies the study", () => {
    const resolved = resolveScreeningRoles({});
    expect(resolved.roles).toEqual({ cervical: "absent", dorsal: "absent", ls: "absent" });
    expect(resolved.matchedKey).toBeNull();
    expect(screeningRolesSummary(resolved.roles)).toBe("cervical=absent dorsal=absent ls=absent");
  });

  it("prefers the billed name over a loose description", () => {
    const resolved = resolveScreeningRoles({
      name: "MRI CERVICAL SPINE SCREENING",
      studyDescription: "lumbar radiculopathy, also image the LS spine",
    });
    expect(resolved.roles.cervical).toBe("primary-screening");
    expect(resolved.roles.ls).toBe("absent");
  });
});
