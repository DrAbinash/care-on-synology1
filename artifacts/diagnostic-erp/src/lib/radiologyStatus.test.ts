/**
 * Unit tests for the Radiology V2 unified status/priority/role mapping —
 * the core shared vocabulary of the Worklist and Reading Room (Phases C–E).
 * Pure functions; no DOM or network needed.
 */
import { describe, it, expect } from "vitest";
import { toUnifiedStatus, priorityInfo, worklistRoleView, UNIFIED_STATUSES } from "./radiologyStatus";

describe("toUnifiedStatus", () => {
  it("maps the internal worklist lifecycle to the 7 user-facing statuses", () => {
    expect(toUnifiedStatus("SCHEDULED").key).toBe("REGISTERED");
    expect(toUnifiedStatus("STUDY_RECEIVED").key).toBe("STUDY_RECEIVED");
    expect(toUnifiedStatus("AI_DRAFT_READY").key).toBe("REPORTING_PENDING");
    expect(toUnifiedStatus("REPORT_IN_PROGRESS").key).toBe("DRAFT_SAVED");
    expect(toUnifiedStatus("REPORT_FINAL").key).toBe("FINAL_REPORT");
    expect(toUnifiedStatus("DELIVERED").key).toBe("DELIVERED");
  });

  it("delivery status wins over report status", () => {
    expect(toUnifiedStatus("REPORT_FINAL", "READY_TO_SEND").key).toBe("PRINTED_SHARED");
    expect(toUnifiedStatus("REPORT_FINAL", "SENT").key).toBe("DELIVERED");
    expect(toUnifiedStatus("REPORT_IN_PROGRESS", "SENT").key).toBe("DELIVERED");
  });

  it("is case-insensitive and safe on unknown/empty input", () => {
    expect(toUnifiedStatus("report_final").key).toBe("FINAL_REPORT");
    expect(toUnifiedStatus("SOMETHING_NEW").key).toBe("STUDY_RECEIVED"); // neutral fallback
    expect(toUnifiedStatus(null).key).toBe("STUDY_RECEIVED");
    expect(toUnifiedStatus(undefined).key).toBe("STUDY_RECEIVED");
  });

  it("every unified status has a label, color and order", () => {
    for (const info of Object.values(UNIFIED_STATUSES)) {
      expect(info.label.length).toBeGreaterThan(0);
      expect(info.color).toContain("bg-");
      expect(info.order).toBeGreaterThan(0);
    }
  });
});

describe("priorityInfo (reuses radiology_studies.priority vocabulary)", () => {
  it("flags stat/emergency/urgent/vip and not routine", () => {
    expect(priorityInfo("stat").highlight).toBe(true);
    expect(priorityInfo("EMERGENCY").highlight).toBe(true);
    expect(priorityInfo("urgent").highlight).toBe(true);
    expect(priorityInfo("vip").highlight).toBe(true);
    expect(priorityInfo("routine").highlight).toBe(false);
    expect(priorityInfo(null).highlight).toBe(false);
    expect(priorityInfo(undefined).label).toBe("Routine");
  });
});

describe("worklistRoleView", () => {
  it("maps staff roles to the four Reading Room views", () => {
    expect(worklistRoleView("admin")).toBe("owner");
    expect(worklistRoleView("super_admin")).toBe("owner");
    expect(worklistRoleView("radiologist")).toBe("radiologist");
    expect(worklistRoleView("senior_sonologist")).toBe("radiologist");
    expect(worklistRoleView("xray_technician")).toBe("technician");
    expect(worklistRoleView("receptionist")).toBe("reception");
    expect(worklistRoleView("front_desk")).toBe("reception");
    expect(worklistRoleView("billing_staff")).toBe("reception");
  });

  it("unknown roles keep full non-owner behavior (backward compatibility)", () => {
    expect(worklistRoleView("mystery_role")).toBe("radiologist");
    expect(worklistRoleView("")).toBe("radiologist");
  });
});
