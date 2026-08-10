import { describe, expect, it } from "vitest";
import { pickDefaultRightTab } from "./pickDefaultRightTab";

describe("pickDefaultRightTab", () => {
  it("prefers copilot when alerts exist", () => {
    expect(pickDefaultRightTab({
      copilotEnabled: true,
      copilotAlertCount: 2,
      priorReportsTotal: 5,
      pendingViewerMeasurements: 1,
      modality: "MR",
    })).toBe("copilot");
  });

  it("opens prior when priors exist and no alerts", () => {
    expect(pickDefaultRightTab({
      copilotEnabled: true,
      copilotAlertCount: 0,
      priorReportsTotal: 3,
      pendingViewerMeasurements: 0,
      modality: "MR",
    })).toBe("prior");
  });

  it("defaults to quickselect for new studies", () => {
    expect(pickDefaultRightTab({
      copilotEnabled: false,
      copilotAlertCount: 0,
      priorReportsTotal: 0,
      pendingViewerMeasurements: 0,
      modality: "MR",
    })).toBe("quickselect");
  });
});
