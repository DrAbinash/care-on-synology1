import { describe, expect, it } from "vitest";
import {
  isActiveMwlStatus,
  isCancellableStudyStatus,
} from "./cancelRadiologyMwlRules";

describe("cancelRadiologyMwlRules pure helpers", () => {
  it("active vs terminal MWL statuses", () => {
    expect(isActiveMwlStatus("SCHEDULED")).toBe(true);
    expect(isActiveMwlStatus("SENT_TO_MWL")).toBe(true);
    expect(isActiveMwlStatus("IN_PROGRESS")).toBe(true);
    expect(isActiveMwlStatus("CANCELLED")).toBe(false);
    expect(isActiveMwlStatus("CANCELED")).toBe(false);
    expect(isActiveMwlStatus("COMPLETED")).toBe(false);
    expect(isActiveMwlStatus("DISCONTINUED")).toBe(false);
    expect(isActiveMwlStatus("ARRIVED")).toBe(false);
  });

  it("cancellable study statuses", () => {
    expect(isCancellableStudyStatus("scheduled")).toBe(true);
    expect(isCancellableStudyStatus("in_progress")).toBe(true);
    expect(isCancellableStudyStatus("acquired")).toBe(true);
    expect(isCancellableStudyStatus("cancelled")).toBe(false);
    expect(isCancellableStudyStatus("delivered")).toBe(false);
  });
});
