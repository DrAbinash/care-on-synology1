import { describe, it, expect } from "vitest";
import { buildAuditEvent, toLogActionPayload } from "./usgAudit";

describe("P2.10 audit", () => {
  it("builds a structural event", () => {
    const e = buildAuditEvent("finding_added", { studyId: 7, organ: "gallbladder", findingType: "Cholelithiasis", actor: "Dr X", at: "2026-07-21T00:00:00Z", detail: { count: 3 } });
    expect(e.action).toBe("finding_added");
    expect(e.studyId).toBe(7);
    expect(e.organ).toBe("gallbladder");
    expect(e.detail.count).toBe(3);
  });

  it("drops prose / PHI-looking detail values", () => {
    const e = buildAuditEvent("report_saved", { detail: {
      count: 2,
      shortCode: "GB1",
      prose: "Multiple mobile calculi are seen within the gallbladder.", // multi-word → dropped
      name: "very long patient identifier string that exceeds the maximum allowed length here", // long → dropped
    } });
    expect(e.detail.count).toBe(2);
    expect(e.detail.shortCode).toBe("GB1");
    expect(e.detail.prose).toBeUndefined();
    expect(e.detail.name).toBeUndefined();
  });

  it("maps to the canonical log-action payload (no new transport)", () => {
    const e = buildAuditEvent("report_finalized", { studyId: 9, organ: "prostate", findingType: "Prostatomegaly", actor: "Dr X" });
    const p = toLogActionPayload(e);
    expect(p.studyId).toBe(9);
    expect(p.action).toBe("USG_REPORT_FINALIZED");
    expect(p.newValue).toBe("prostate:Prostatomegaly");
    expect(p.details.organ).toBe("prostate");
    expect(p.details.actor).toBe("Dr X");
  });
});
