import { describe, it, expect } from "vitest";
import {
  buildActivationView, groupBActivatable, GROUP_A_FLAGS, GROUP_B_FLAGS,
  USG_ACTIVATION_PLAN, type InfraHealth,
} from "./usgActivationService";

const health = (over: Partial<InfraHealth> = {}): InfraHealth => ({
  orthanc: { ok: false, message: "unreachable", checkedServerSide: true },
  viewer: { ok: false, message: "client-side", checkedServerSide: false },
  ai_gateway: { ok: false, message: "not set", checkedServerSide: true },
  ...over,
});

describe("activation plan — grouping", () => {
  it("classifies safe (A) vs infra (B) flags with no overlap", () => {
    expect(GROUP_A_FLAGS).toContain("ff_radiology_usg_workspace");
    expect(GROUP_A_FLAGS).toContain("ff_radiology_usg_ob_canonical");
    expect(GROUP_B_FLAGS).toContain("ff_radiology_usg_report_to_pacs");
    expect(GROUP_B_FLAGS).toContain("ff_radiology_usg_ai_assistant");
    expect(GROUP_A_FLAGS.some((f) => GROUP_B_FLAGS.includes(f))).toBe(false);
    expect(USG_ACTIVATION_PLAN.length).toBe(GROUP_A_FLAGS.length + GROUP_B_FLAGS.length);
  });
});

describe("buildActivationView — status + activatability", () => {
  it("marks Group A available regardless of infra", () => {
    const view = buildActivationView({}, health());
    const ob = view.find((v) => v.flag === "ff_radiology_usg_ob_canonical")!;
    expect(ob.status).toBe("Available");
    expect(ob.activatable).toBe(true);
  });

  it("marks Group B needing infra when health fails, with remediation", () => {
    const view = buildActivationView({}, health());
    const pacs = view.find((v) => v.flag === "ff_radiology_usg_report_to_pacs")!;
    expect(pacs.status).toBe("Needs Orthanc");
    expect(pacs.activatable).toBe(false);
    expect(pacs.remediation).toMatch(/unreachable/);
    const ai = view.find((v) => v.flag === "ff_radiology_usg_ai_assistant")!;
    expect(ai.status).toBe("Needs AI Gateway");
  });

  it("makes an Orthanc-backed flag activatable once Orthanc is healthy", () => {
    const view = buildActivationView({}, health({ orthanc: { ok: true, message: "Orthanc reachable", checkedServerSide: true } }));
    const pacs = view.find((v) => v.flag === "ff_radiology_usg_report_to_pacs")!;
    expect(pacs.status).toBe("Available");
    expect(pacs.activatable).toBe(true);
    // AI still needs its gateway.
    expect(view.find((v) => v.flag === "ff_radiology_usg_ai_assistant")!.activatable).toBe(false);
  });

  it("shows an enabled flag as Live", () => {
    const view = buildActivationView({ ff_radiology_usg_workspace: true }, health());
    expect(view.find((v) => v.flag === "ff_radiology_usg_workspace")!.status).toBe("Live");
  });
});

describe("groupBActivatable — only healthy infra", () => {
  it("returns only flags whose infra passes", () => {
    const both = groupBActivatable(health({
      orthanc: { ok: true, message: "ok", checkedServerSide: true },
      ai_gateway: { ok: true, message: "ok", checkedServerSide: true },
    }));
    expect(both).toContain("ff_radiology_usg_report_to_pacs");
    expect(both).toContain("ff_radiology_usg_ai_assistant");
    // viewer still false → cine / exact_provenance excluded
    expect(both).not.toContain("ff_radiology_usg_cine");
    expect(groupBActivatable(health())).toEqual([]); // nothing healthy
  });
});
