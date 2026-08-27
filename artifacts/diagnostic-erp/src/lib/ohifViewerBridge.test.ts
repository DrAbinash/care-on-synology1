import { describe, expect, it } from "vitest";
import { isCareOhifMessage, CARE_OHIF_SOURCE } from "./ohifViewerBridge";

describe("ohifViewerBridge", () => {
  it("accepts measurement and key-image contracts", () => {
    expect(isCareOhifMessage({
      source: CARE_OHIF_SOURCE,
      type: "measurement",
      studyInstanceUID: "1.2.3",
      value: 12.5,
    })).toBe(true);
    expect(isCareOhifMessage({
      source: CARE_OHIF_SOURCE,
      type: "key-image",
      studyInstanceUID: "1.2.3",
      seriesInstanceUID: "1.2.4",
      sopInstanceUID: "1.2.5",
    })).toBe(true);
    expect(isCareOhifMessage({ type: "measurement" })).toBe(false);
  });
});
